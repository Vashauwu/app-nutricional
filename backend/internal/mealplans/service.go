package mealplans

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/audit"
	"github.com/nutri/app-nutricional/backend/internal/nutrition_engine/calculator"
)

var (
	ErrNotFound       = errors.New("no encontrado")
	ErrReadOnly       = errors.New("el plan es histórico (finalizado o archivado) y no se puede modificar")
	ErrConsentPending = errors.New("el expediente clínico está restringido hasta que se acepten el aviso de privacidad y el consentimiento informado")
	ErrBadTransition  = errors.New("esa acción no está permitida en el estado actual del plan")
	ErrEmptyPlan      = errors.New("el plan no tiene platillos")
)

type ValidationError map[string]string

func (v ValidationError) Error() string { return "datos inválidos" }

// ConflictError: otra persona o sesión modificó el plan; lleva la versión vigente para que el cliente decida (§9.3).
type ConflictError struct{ Current PlanView }

func (ConflictError) Error() string { return "el plan fue modificado por otra persona o sesión" }

type Actor struct {
	ID        uuid.UUID
	RequestID string
}

// Patients es lo que se necesita del módulo de pacientes.
type Patients interface {
	Get(ctx context.Context, id uuid.UUID) (db.Patient, error)
	ConsentComplete(ctx context.Context, id uuid.UUID) (bool, error)
}

type Service struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	patients Patients
	audit    audit.Recorder
	log      *slog.Logger
	loc      *time.Location
	now      func() time.Time
}

func NewService(pool *pgxpool.Pool, patients Patients, tz string, log *slog.Logger) *Service {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	q := db.New(pool)
	return &Service{pool: pool, q: q, patients: patients, audit: audit.Recorder{Q: q, Log: log}, log: log, loc: loc, now: time.Now}
}

// Today es la fecha de hoy en la zona horaria configurada (§19.1).
func (s *Service) Today() time.Time {
	n := s.now().In(s.loc)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
}

func (s *Service) rec(ctx context.Context, a Actor, action string, plan uuid.UUID, meta map[string]any) {
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: action, ResourceType: "meal_plan", ResourceID: plan, RequestID: a.RequestID, Metadata: meta})
}

func readOnly(status string) bool { return status == "finished" || status == "archived" }

func pgDate(t time.Time) pgtype.Date { return pgtype.Date{Time: t, Valid: true} }

func parseDate(s string) (time.Time, error) { return time.Parse("2006-01-02", s) }

func fmtDate(d pgtype.Date) string { return d.Time.Format("2006-01-02") }

// ---------- Validación y escritura del documento ----------
const maxDays = 120

func validate(doc *Document) ValidationError {
	errs := ValidationError{}
	if strings.TrimSpace(doc.Name) == "" || len(doc.Name) > 120 {
		errs["name"] = "el nombre es obligatorio (máx. 120 caracteres)"
	}
	t := doc.Targets
	for k, v := range map[string]decimal.Decimal{"energy_kcal": t.Energy, "protein_g": t.Protein, "carbohydrates_g": t.Carbs, "lipids_g": t.Lipids} {
		if v.IsNegative() {
			errs["targets."+k] = "no puede ser negativo"
		}
	}
	for code, v := range t.Equivalents {
		if v.IsNegative() {
			errs["targets.equivalents."+code] = "no puede ser negativo"
		}
	}
	if len(doc.Days) == 0 || len(doc.Days) > maxDays {
		errs["days"] = fmt.Sprintf("el plan debe tener entre 1 y %d días", maxDays)
		return errs
	}
	seen := map[string]bool{}
	for di := range doc.Days {
		d := &doc.Days[di]
		if _, err := parseDate(d.Date); err != nil {
			errs[fmt.Sprintf("days[%d].date", di)] = "usa el formato AAAA-MM-DD"
			continue
		}
		if seen[d.Date] {
			errs[fmt.Sprintf("days[%d].date", di)] = "fecha repetida"
		}
		seen[d.Date] = true
		if len(d.Notes) > 2000 {
			errs[fmt.Sprintf("days[%d].notes", di)] = "máximo 2000 caracteres"
		}
		if len(d.Slots) > 12 {
			errs[fmt.Sprintf("days[%d].slots", di)] = "máximo 12 tiempos de comida por día"
		}
		names := map[string]bool{}
		for si := range d.Slots {
			sl := &d.Slots[si]
			key := strings.ToLower(strings.TrimSpace(sl.Name))
			if key == "" || len(sl.Name) > 60 {
				errs[fmt.Sprintf("days[%d].slots[%d].name", di, si)] = "el nombre del tiempo de comida es obligatorio"
			} else if names[key] {
				errs[fmt.Sprintf("days[%d].slots[%d].name", di, si)] = "tiempo de comida repetido en el día"
			}
			names[key] = true
			if sl.ID == uuid.Nil {
				sl.ID = uuid.New()
			}
			if len(sl.Items) > 30 {
				errs[fmt.Sprintf("days[%d].slots[%d].items", di, si)] = "máximo 30 platillos por tiempo de comida"
			}
			for ii := range sl.Items {
				it := &sl.Items[ii]
				if it.ID == uuid.Nil {
					it.ID = uuid.New()
				}
				if it.Servings.Sign() <= 0 || it.Servings.GreaterThan(decimal.NewFromInt(50)) {
					errs[fmt.Sprintf("days[%d].slots[%d].items[%d].servings", di, si, ii)] = "las porciones deben estar entre 0 y 50"
				}
				if it.DishID == uuid.Nil || it.DishVersion < 1 {
					errs[fmt.Sprintf("days[%d].slots[%d].items[%d].dish", di, si, ii)] = "indica el platillo y su versión"
				}
				if len(it.Instructions) > 1000 {
					errs[fmt.Sprintf("days[%d].slots[%d].items[%d].instructions", di, si, ii)] = "máximo 1000 caracteres"
				}
			}
		}
	}
	return errs
}

func span(doc Document) (time.Time, time.Time) {
	var lo, hi time.Time
	for i, d := range doc.Days {
		t, _ := parseDate(d.Date)
		if i == 0 || t.Before(lo) {
			lo = t
		}
		if i == 0 || t.After(hi) {
			hi = t
		}
	}
	return lo, hi
}

func eqJSON(m map[string]decimal.Decimal) []byte {
	out := map[string]string{}
	for k, v := range m {
		if v.Sign() > 0 {
			out[k] = v.String()
		}
	}
	b, _ := json.Marshal(out)
	return b
}

func parseEq(raw []byte) map[string]decimal.Decimal {
	out := map[string]decimal.Decimal{}
	var m map[string]string
	if json.Unmarshal(raw, &m) == nil {
		for k, v := range m {
			if d, err := decimal.NewFromString(v); err == nil {
				out[k] = d
			}
		}
	}
	return out
}

// writeDoc concilia el documento con la base: inserta/actualiza lo enviado y quita (de forma lógica) lo ausente.
// Se rechazan identificadores que pertenezcan a otro plan.
func (s *Service) writeDoc(ctx context.Context, q *db.Queries, planID uuid.UUID, doc Document) error {
	var slotIDs, itemIDs []uuid.UUID
	for _, d := range doc.Days {
		for _, sl := range d.Slots {
			slotIDs = append(slotIDs, sl.ID)
			for _, it := range sl.Items {
				itemIDs = append(itemIDs, it.ID)
			}
		}
	}
	owners, err := q.SlotPlanIDs(ctx, slotIDs)
	if err != nil {
		return err
	}
	for _, o := range owners {
		if o.PlanID != planID {
			return ValidationError{"days": "un tiempo de comida pertenece a otro plan"}
		}
	}
	iowners, err := q.ItemPlanIDs(ctx, itemIDs)
	if err != nil {
		return err
	}
	for _, o := range iowners {
		if o.PlanID != planID {
			return ValidationError{"days": "un platillo pertenece a otro plan"}
		}
	}
	dates := make([]pgtype.Date, 0, len(doc.Days))
	for _, d := range doc.Days {
		t, _ := parseDate(d.Date)
		dates = append(dates, pgDate(t))
	}
	if err := q.RemoveDaysNotIn(ctx, db.RemoveDaysNotInParams{PlanID: planID, Column2: dates}); err != nil {
		return err
	}
	for _, d := range doc.Days {
		t, _ := parseDate(d.Date)
		dayID, err := q.UpsertDay(ctx, db.UpsertDayParams{PlanID: planID, PlanDate: pgDate(t), Notes: d.Notes})
		if err != nil {
			return err
		}
		for si, sl := range d.Slots {
			if err := q.UpsertSlot(ctx, db.UpsertSlotParams{ID: sl.ID, DayID: dayID, Name: strings.TrimSpace(sl.Name), Position: int32(si)}); err != nil {
				return err
			}
		}
	}
	if err := q.RemoveSlotsNotIn(ctx, db.RemoveSlotsNotInParams{PlanID: planID, Column2: slotIDs}); err != nil {
		return err
	}
	for _, d := range doc.Days {
		for _, sl := range d.Slots {
			for ii, it := range sl.Items {
				if err := q.UpsertItem(ctx, db.UpsertItemParams{ID: it.ID, SlotID: sl.ID, Position: int32(ii), DishID: it.DishID, DishVersion: it.DishVersion, Servings: it.Servings, Instructions: strings.TrimSpace(it.Instructions)}); err != nil {
					if strings.Contains(err.Error(), "meal_slot_items_dish_id_dish_version_fkey") {
						return ValidationError{"days": "algún platillo o versión no existe"}
					}
					return err
				}
			}
		}
	}
	return q.RemoveItemsNotIn(ctx, db.RemoveItemsNotInParams{PlanID: planID, Column2: itemIDs})
}

func targetsOf(p db.MealPlan) Targets {
	return Targets{Energy: p.TargetEnergy, Protein: p.TargetProtein, Carbs: p.TargetCarbs, Lipids: p.TargetLipids, Equivalents: parseEq(p.TargetEquivalents)}
}

// docOf reconstruye el documento (sin enriquecer) tal como está en la base.
func (s *Service) docOf(ctx context.Context, q *db.Queries, p db.MealPlan) (Document, error) {
	days, err := q.ListDays(ctx, p.ID)
	if err != nil {
		return Document{}, err
	}
	slots, err := q.ListPlanSlots(ctx, p.ID)
	if err != nil {
		return Document{}, err
	}
	items, err := q.ListPlanItems(ctx, p.ID)
	if err != nil {
		return Document{}, err
	}
	doc := Document{Name: p.Name, Targets: targetsOf(p), Days: []Day{}}
	idx := map[string]int{}
	for _, d := range days {
		k := fmtDate(d.PlanDate)
		idx[k] = len(doc.Days)
		doc.Days = append(doc.Days, Day{Date: k, Notes: d.Notes, Slots: []Slot{}})
	}
	slotAt := map[uuid.UUID][2]int{}
	for _, sl := range slots {
		di := idx[fmtDate(sl.PlanDate)]
		slotAt[sl.ID] = [2]int{di, len(doc.Days[di].Slots)}
		doc.Days[di].Slots = append(doc.Days[di].Slots, Slot{ID: sl.ID, Name: sl.Name, Items: []Item{}})
	}
	for _, it := range items {
		at := slotAt[it.SlotID]
		sl := &doc.Days[at[0]].Slots[at[1]]
		sl.Items = append(sl.Items, Item{ID: it.ItemID, DishID: it.DishID, DishVersion: it.DishVersion, Servings: it.Servings, Instructions: it.Instructions})
	}
	return doc, nil
}

// ---------- Vista enriquecida ----------
func scale(n calculator.Nutrients, f decimal.Decimal) calculator.Nutrients {
	return calculator.Nutrients{EnergyKcal: n.EnergyKcal.Mul(f), ProteinG: n.ProteinG.Mul(f), CarbohydratesG: n.CarbohydratesG.Mul(f), LipidsG: n.LipidsG.Mul(f), FiberG: n.FiberG.Mul(f)}
}

func addTotals(a, b Totals) Totals {
	eq := map[string]decimal.Decimal{}
	for k, v := range a.Equivalents {
		eq[k] = v
	}
	for k, v := range b.Equivalents {
		eq[k] = eq[k].Add(v)
	}
	return Totals{Nutrients: a.Nutrients.Add(b.Nutrients), Equivalents: eq}
}

func emptyTotals() Totals { return Totals{Equivalents: map[string]decimal.Decimal{}} }

func itemView(it db.ListPlanItemsRow) ItemView {
	per := calculator.Nutrients{EnergyKcal: it.ServingEnergy, ProteinG: it.ServingProtein, CarbohydratesG: it.ServingCarbs, LipidsG: it.ServingLipids, FiberG: it.ServingFiber}
	eq := map[string]decimal.Decimal{}
	for k, v := range parseEq(it.Equivalents) {
		eq[k] = v.Mul(it.Servings)
	}
	return ItemView{
		ID: it.ItemID, DishID: it.DishID, DishName: it.DishName, DishCategory: it.DishCategory, DishInactive: it.DishStatus != "active", DishVersion: it.DishVersion,
		LatestVersion: it.DishLatest, Servings: it.Servings, Instructions: it.Instructions, PerServing: per, Totals: Totals{Nutrients: scale(per, it.Servings), Equivalents: eq},
	}
}

func (s *Service) view(ctx context.Context, p db.MealPlan) (PlanView, error) {
	doc, err := s.docOf(ctx, s.q, p)
	if err != nil {
		return PlanView{}, err
	}
	items, err := s.q.ListPlanItems(ctx, p.ID)
	if err != nil {
		return PlanView{}, err
	}
	byID := map[uuid.UUID]db.ListPlanItemsRow{}
	for _, it := range items {
		byID[it.ItemID] = it
	}
	out := PlanView{
		ID: p.ID, PatientID: p.PatientID, Name: p.Name, Status: p.Status, StartDate: fmtDate(p.StartDate), EndDate: fmtDate(p.EndDate), Revision: p.Revision,
		Targets: doc.Targets, TargetsVersion: p.TargetsVersion, Days: make([]DayView, 0, len(doc.Days)), UpdatedAt: p.UpdatedAt.Time, CreatedAt: p.CreatedAt.Time, ReadOnly: readOnly(p.Status),
	}
	if pt, err := s.patients.Get(ctx, p.PatientID); err == nil {
		out.PatientName = pt.FirstName + " " + pt.LastName
	}
	for _, d := range doc.Days {
		dv := DayView{Date: d.Date, Notes: d.Notes, Slots: make([]SlotView, 0, len(d.Slots)), Totals: emptyTotals()}
		for _, sl := range d.Slots {
			sv := SlotView{ID: sl.ID, Name: sl.Name, Items: make([]ItemView, 0, len(sl.Items)), Totals: emptyTotals()}
			for _, it := range sl.Items {
				iv := itemView(byID[it.ID])
				sv.Items = append(sv.Items, iv)
				sv.Totals = addTotals(sv.Totals, iv.Totals)
			}
			dv.Totals = addTotals(dv.Totals, sv.Totals)
			dv.Slots = append(dv.Slots, sv)
		}
		out.Days = append(out.Days, dv)
	}
	return out, nil
}

// ---------- Consulta ----------
func (s *Service) Get(ctx context.Context, id uuid.UUID) (PlanView, error) {
	if err := s.FinalizeExpired(ctx); err != nil {
		return PlanView{}, err
	}
	p, err := s.q.GetPlan(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return PlanView{}, ErrNotFound
	}
	if err != nil {
		return PlanView{}, err
	}
	return s.view(ctx, p)
}

type ListQuery struct {
	Search, Status string
	PatientID      uuid.UUID
	From, To       string
	Page, PageSize int
}

func (s *Service) List(ctx context.Context, q ListQuery) (ListResult, error) {
	if err := s.FinalizeExpired(ctx); err != nil {
		return ListResult{}, err
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 || q.PageSize > 100 {
		q.PageSize = 20
	}
	params := db.ListPlansParams{Status: q.Status, PatientID: q.PatientID, Search: strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(q.Search)),
		PageLimit: int32(q.PageSize), PageOffset: int32((q.Page - 1) * q.PageSize)}
	if t, err := parseDate(q.From); err == nil {
		params.FromDate = pgDate(t)
	}
	if t, err := parseDate(q.To); err == nil {
		params.ToDate = pgDate(t)
	}
	rows, err := s.q.ListPlans(ctx, params)
	if err != nil {
		return ListResult{}, err
	}
	out := ListResult{Items: []ListItem{}, Page: q.Page, PageSize: q.PageSize}
	for _, r := range rows {
		out.Total = r.Total
		out.Items = append(out.Items, ListItem{ID: r.ID, PatientID: r.PatientID, PatientName: r.FirstName + " " + r.LastName, Name: r.Name, Status: r.Status,
			StartDate: fmtDate(r.StartDate), EndDate: fmtDate(r.EndDate), Revision: r.Revision, ItemCount: r.ItemCount, UpdatedAt: r.UpdatedAt.Time})
	}
	return out, nil
}

// FinalizeExpired pasa a "finalizado" los planes publicados cuyo periodo terminó (§11). Es idempotente.
func (s *Service) FinalizeExpired(ctx context.Context) error {
	rows, err := s.q.FinalizeExpiredPlans(ctx, pgDate(s.Today()))
	if err != nil {
		return err
	}
	for _, r := range rows {
		if err := s.q.InsertPlanEvent(ctx, db.InsertPlanEventParams{PlanID: r.ID, Type: "finished", Summary: "Finalizado automáticamente al terminar el periodo"}); err != nil {
			return err
		}
	}
	return nil
}

// snapshot guarda una revisión inmutable del documento actual.
func (s *Service) snapshot(ctx context.Context, q *db.Queries, p db.MealPlan, by uuid.UUID) error {
	doc, err := s.docOf(ctx, q, p)
	if err != nil {
		return err
	}
	b, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	return q.InsertRevision(ctx, db.InsertRevisionParams{PlanID: p.ID, Revision: p.Revision, SavedBy: by, Snapshot: b})
}

func (s *Service) event(ctx context.Context, q *db.Queries, plan uuid.UUID, a Actor, typ, summary string) error {
	return q.InsertPlanEvent(ctx, db.InsertPlanEventParams{PlanID: plan, Actor: uuid.NullUUID{UUID: a.ID, Valid: a.ID != uuid.Nil}, Type: typ, Summary: summary})
}
