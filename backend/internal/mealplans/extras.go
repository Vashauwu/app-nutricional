package mealplans

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/dishes"
	"github.com/nutri/app-nutricional/backend/internal/nutrition_engine/calculator"
)

// ---------- Plantillas (§10) ----------
type TemplateInput struct {
	Name, Description, Scope string
	From, To                 string
}

func (s *Service) SaveTemplate(ctx context.Context, a Actor, planID uuid.UUID, in TemplateInput) (TemplateView, error) {
	errs := ValidationError{}
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 120 {
		errs["name"] = "el nombre es obligatorio (máx. 120 caracteres)"
	}
	if in.Scope != "global" && in.Scope != "patient" {
		errs["scope"] = "el alcance debe ser global o patient"
	}
	from, e1 := parseDate(in.From)
	to, e2 := parseDate(in.To)
	if e1 != nil || e2 != nil || to.Before(from) {
		errs["range"] = "indica un rango de fechas válido (AAAA-MM-DD)"
	}
	if len(errs) > 0 {
		return TemplateView{}, errs
	}
	p, err := s.q.GetPlan(ctx, planID)
	if errors.Is(err, pgx.ErrNoRows) {
		return TemplateView{}, ErrNotFound
	}
	if err != nil {
		return TemplateView{}, err
	}
	doc, err := s.docOf(ctx, s.q, p)
	if err != nil {
		return TemplateView{}, err
	}
	var days []templateDay
	for _, d := range doc.Days {
		t, _ := parseDate(d.Date)
		if t.Before(from) || t.After(to) {
			continue
		}
		td := templateDay{Offset: len(days)}
		for _, sl := range d.Slots {
			ts := templateSlot{Name: sl.Name, Items: []templateItem{}}
			for _, it := range sl.Items {
				ts.Items = append(ts.Items, templateItem{DishID: it.DishID, DishVersion: it.DishVersion, Servings: it.Servings, Instructions: it.Instructions})
			}
			td.Slots = append(td.Slots, ts)
		}
		days = append(days, td)
	}
	if len(days) == 0 {
		return TemplateView{}, ValidationError{"range": "el rango no contiene días del plan"}
	}
	b, _ := json.Marshal(days)
	patient := uuid.NullUUID{}
	if in.Scope == "patient" {
		patient = uuid.NullUUID{UUID: p.PatientID, Valid: true}
	}
	t, err := s.q.InsertTemplate(ctx, db.InsertTemplateParams{Name: strings.TrimSpace(in.Name), Description: in.Description, Scope: in.Scope, PatientID: patient, Structure: b, CreatedBy: a.ID})
	if err != nil {
		return TemplateView{}, err
	}
	s.rec(ctx, a, "template.create", t.ID, nil)
	return templateView(t), nil
}

func templateView(t db.MealPlanTemplate) TemplateView {
	var days []templateDay
	_ = json.Unmarshal(t.Structure, &days)
	v := TemplateView{ID: t.ID, Name: t.Name, Description: t.Description, Scope: t.Scope, Days: len(days), CreatedAt: t.CreatedAt.Time}
	if t.PatientID.Valid {
		id := t.PatientID.UUID
		v.PatientID = &id
	}
	return v
}

func (s *Service) Templates(ctx context.Context, patientID uuid.UUID) ([]TemplateView, error) {
	rows, err := s.q.ListTemplates(ctx, patientID)
	if err != nil {
		return nil, err
	}
	out := []TemplateView{}
	for _, r := range rows {
		v := TemplateView{ID: r.ID, Name: r.Name, Description: r.Description, Scope: r.Scope, Days: int(r.DayCount), CreatedAt: r.CreatedAt.Time}
		if r.PatientID.Valid {
			id := r.PatientID.UUID
			v.PatientID = &id
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *Service) DuplicateTemplate(ctx context.Context, a Actor, id uuid.UUID) (TemplateView, error) {
	t, err := s.q.GetTemplate(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return TemplateView{}, ErrNotFound
	}
	if err != nil {
		return TemplateView{}, err
	}
	n, err := s.q.InsertTemplate(ctx, db.InsertTemplateParams{Name: "Copia de " + t.Name, Description: t.Description, Scope: t.Scope, PatientID: t.PatientID, Structure: t.Structure, CreatedBy: a.ID})
	if err != nil {
		return TemplateView{}, err
	}
	s.rec(ctx, a, "template.duplicate", n.ID, nil)
	return templateView(n), nil
}

// DeleteTemplate no afecta a los planes ya creados desde ella: cada plan conserva su copia.
func (s *Service) DeleteTemplate(ctx context.Context, a Actor, id uuid.UUID) error {
	n, err := s.q.SoftDeleteTemplate(ctx, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.rec(ctx, a, "template.delete", id, nil)
	return nil
}

// ---------- Historial y revisiones (§11) ----------
func (s *Service) History(ctx context.Context, planID uuid.UUID) (History, error) {
	if _, err := s.q.GetPlan(ctx, planID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return History{}, ErrNotFound
		}
		return History{}, err
	}
	evs, err := s.q.ListPlanEvents(ctx, planID)
	if err != nil {
		return History{}, err
	}
	pubs, err := s.q.ListPublications(ctx, planID)
	if err != nil {
		return History{}, err
	}
	revs, err := s.q.ListRevisions(ctx, planID)
	if err != nil {
		return History{}, err
	}
	h := History{Events: []EventView{}, Publications: []PublicationView{}, Revisions: []RevisionView{}}
	for _, e := range evs {
		ev := EventView{ID: e.ID, At: e.At.Time, Type: e.Type, Summary: e.Summary}
		if e.Actor.Valid {
			id := e.Actor.UUID
			ev.Actor = &id
		}
		h.Events = append(h.Events, ev)
	}
	for _, p := range pubs {
		h.Publications = append(h.Publications, PublicationView{VersionNumber: p.VersionNumber, Revision: p.Revision, PublishedAt: p.PublishedAt.Time, Summary: p.Summary})
	}
	for _, r := range revs {
		h.Revisions = append(h.Revisions, RevisionView{Revision: r.Revision, SavedAt: r.SavedAt.Time})
	}
	return h, nil
}

type RevisionDetail struct {
	Revision int32     `json:"revision"`
	SavedAt  time.Time `json:"saved_at"`
	Days     []DayView `json:"days"`
}

type dishKey struct {
	id uuid.UUID
	v  int32
}

// enrich arma la vista de un documento guardado (p. ej. una revisión) usando versiones inmutables de platillos.
func (s *Service) enrich(ctx context.Context, days []Day) ([]DayView, error) {
	cache := map[dishKey]ItemView{}
	out := make([]DayView, 0, len(days))
	for _, d := range days {
		dv := DayView{Date: d.Date, Notes: d.Notes, Slots: []SlotView{}, Totals: emptyTotals()}
		for _, sl := range d.Slots {
			sv := SlotView{ID: sl.ID, Name: sl.Name, Items: []ItemView{}, Totals: emptyTotals()}
			for _, it := range sl.Items {
				k := dishKey{it.DishID, it.DishVersion}
				base, ok := cache[k]
				if !ok {
					dish, err := s.q.GetDishForPlan(ctx, it.DishID)
					if err != nil {
						return nil, err
					}
					ver, err := s.q.GetDishVersion(ctx, db.GetDishVersionParams{DishID: it.DishID, VersionNumber: it.DishVersion})
					if err != nil {
						return nil, err
					}
					sn, err := s.q.GetSnapshot(ctx, ver.ID)
					if err != nil {
						return nil, err
					}
					base = ItemView{DishID: it.DishID, DishName: dish.Name, DishVersion: it.DishVersion, LatestVersion: dish.CurrentVersion,
						PerServing: calculator.Nutrients{EnergyKcal: sn.ServingEnergy, ProteinG: sn.ServingProtein, CarbohydratesG: sn.ServingCarbs, LipidsG: sn.ServingLipids, FiberG: sn.ServingFiber}}
					base.Totals.Equivalents = parseEq(sn.Equivalents)
					cache[k] = base
				}
				iv := base
				iv.ID, iv.Servings, iv.Instructions = it.ID, it.Servings, it.Instructions
				eq := map[string]decimal.Decimal{}
				for c, v := range base.Totals.Equivalents {
					eq[c] = v.Mul(it.Servings)
				}
				iv.Totals = Totals{Nutrients: scale(base.PerServing, it.Servings), Equivalents: eq}
				sv.Items = append(sv.Items, iv)
				sv.Totals = addTotals(sv.Totals, iv.Totals)
			}
			dv.Totals = addTotals(dv.Totals, sv.Totals)
			dv.Slots = append(dv.Slots, sv)
		}
		out = append(out, dv)
	}
	return out, nil
}

// RevisionView muestra exactamente lo que había en el plan en esa revisión.
func (s *Service) RevisionView(ctx context.Context, planID uuid.UUID, revision int32) (RevisionDetail, error) {
	r, err := s.q.GetRevision(ctx, db.GetRevisionParams{PlanID: planID, Revision: revision})
	if errors.Is(err, pgx.ErrNoRows) {
		return RevisionDetail{}, ErrNotFound
	}
	if err != nil {
		return RevisionDetail{}, err
	}
	var doc Document
	if err := json.Unmarshal(r.Snapshot, &doc); err != nil {
		return RevisionDetail{}, err
	}
	days, err := s.enrich(ctx, doc.Days)
	if err != nil {
		return RevisionDetail{}, err
	}
	return RevisionDetail{Revision: r.Revision, SavedAt: r.SavedAt.Time, Days: days}, nil
}

// ---------- Rol paciente: solo su plan publicado ----------
type PatientPlan struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	StartDate string    `json:"start_date"`
	EndDate   string    `json:"end_date"`
	Days      []DayView `json:"days"`
}

// PatientPlan devuelve el plan vigente de la paciente (sin objetivos ni datos internos) o ErrNotFound.
func (s *Service) PatientPlan(ctx context.Context, patientID uuid.UUID) (PatientPlan, error) {
	if err := s.FinalizeExpired(ctx); err != nil {
		return PatientPlan{}, err
	}
	p, err := s.q.CurrentPublishedPlan(ctx, db.CurrentPublishedPlanParams{PatientID: patientID, StartDate: pgDate(s.Today())})
	if errors.Is(err, pgx.ErrNoRows) {
		return PatientPlan{}, ErrNotFound
	}
	if err != nil {
		return PatientPlan{}, err
	}
	v, err := s.view(ctx, p)
	if err != nil {
		return PatientPlan{}, err
	}
	return PatientPlan{ID: v.ID, Name: v.Name, StartDate: v.StartDate, EndDate: v.EndDate, Days: v.Days}, nil
}

type PatientDish struct {
	ID              uuid.UUID                  `json:"id"`
	Name            string                     `json:"name"`
	Category        string                     `json:"category"`
	Version         int32                      `json:"version"`
	Description     string                     `json:"description"`
	RecipeMode      string                     `json:"recipe_mode"`
	Instructions    string                     `json:"instructions_text"`
	Steps           []string                   `json:"steps"`
	Servings        decimal.Decimal            `json:"servings"`
	PrepTimeMinutes int32                      `json:"prep_time_minutes"`
	Recommendations string                     `json:"recommendations"`
	Ingredients     []PatientIngredient        `json:"ingredients"`
	PerServing      calculator.Nutrients       `json:"per_serving"`
	Equivalents     map[string]decimal.Decimal `json:"equivalents"`
	Alternatives    []PatientAlternative       `json:"alternatives"`
}

type PatientIngredient struct {
	Name     string          `json:"name"`
	Quantity decimal.Decimal `json:"quantity"`
	Unit     string          `json:"unit"`
}

type PatientAlternative struct {
	Label string          `json:"label"`
	Diff  json.RawMessage `json:"diff"`
}

// DishReader lo implementa dishes.Service.
type DishReader interface {
	Get(ctx context.Context, id uuid.UUID, version int32) (dishes.DishView, error)
}

// PatientDish solo muestra un platillo si aparece en el plan publicado DE ESA paciente. Excluye datos internos
// (motivos de cambio, versiones, quién autorizó). La paciente no puede modificar la composición (§8).
func (s *Service) PatientDish(ctx context.Context, dr DishReader, patientID, dishID uuid.UUID, version int32) (PatientDish, error) {
	ok, err := s.q.DishInPatientPublishedPlan(ctx, db.DishInPatientPublishedPlanParams{PatientID: patientID, DishID: dishID, DishVersion: version})
	if err != nil {
		return PatientDish{}, err
	}
	if !ok {
		return PatientDish{}, ErrNotFound
	}
	d, err := dr.Get(ctx, dishID, version)
	if err != nil {
		return PatientDish{}, err
	}
	v := d.Version
	out := PatientDish{ID: d.ID, Name: d.Name, Category: d.Category, Version: v.VersionNumber, Description: v.Description, RecipeMode: v.RecipeMode, Instructions: v.InstructionsText,
		Steps: v.Steps, Servings: v.Servings, PrepTimeMinutes: v.PrepTimeMinutes, Recommendations: v.Recommendations, PerServing: v.Nutrition.PerServing,
		Equivalents: v.Nutrition.Equivalents, Ingredients: []PatientIngredient{}, Alternatives: []PatientAlternative{}}
	for _, i := range v.Ingredients {
		out.Ingredients = append(out.Ingredients, PatientIngredient{Name: i.Name, Quantity: i.Quantity, Unit: i.Unit})
	}
	for _, sub := range v.Substitutions {
		out.Alternatives = append(out.Alternatives, PatientAlternative{Label: sub.Label, Diff: sub.Diff})
	}
	return out, nil
}
