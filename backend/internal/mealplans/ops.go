package mealplans

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/generated/db"
)

type CreateInput struct {
	PatientID    uuid.UUID
	Name         string
	Start, End   string
	Targets      *Targets
	TemplateID   uuid.UUID
	CopyFromPlan uuid.UUID
}

func defaultTargets() Targets {
	return Targets{Energy: decimal.NewFromInt(1800), Protein: decimal.NewFromInt(90), Carbs: decimal.NewFromInt(220), Lipids: decimal.NewFromInt(60), Equivalents: map[string]decimal.Decimal{}}
}

func blankDays(start, end time.Time) []Day {
	var days []Day
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		slots := make([]Slot, 0, len(DefaultSlots))
		for _, n := range DefaultSlots {
			slots = append(slots, Slot{ID: uuid.New(), Name: n, Items: []Item{}})
		}
		days = append(days, Day{Date: d.Format("2006-01-02"), Slots: slots})
	}
	return days
}

// cloneItems da identificadores nuevos: lo copiado es independiente del origen (§10, §11).
func cloneSlots(src []Slot) []Slot {
	out := make([]Slot, 0, len(src))
	for _, sl := range src {
		n := Slot{ID: uuid.New(), Name: sl.Name, Items: make([]Item, 0, len(sl.Items))}
		for _, it := range sl.Items {
			it.ID = uuid.New()
			n.Items = append(n.Items, it)
		}
		out = append(out, n)
	}
	return out
}

// Create crea un plan en BORRADOR. El expediente clínico debe estar habilitado (consentimientos completos).
func (s *Service) Create(ctx context.Context, a Actor, in CreateInput) (PlanView, error) {
	errs := ValidationError{}
	start, e1 := parseDate(in.Start)
	end, e2 := parseDate(in.End)
	if e1 != nil || e2 != nil {
		errs["dates"] = "usa el formato AAAA-MM-DD en inicio y término"
	} else if end.Before(start) {
		errs["end_date"] = "la fecha de término debe ser posterior al inicio"
	} else if end.Sub(start) > time.Duration(maxDays-1)*24*time.Hour {
		errs["end_date"] = fmt.Sprintf("el plan no puede durar más de %d días", maxDays)
	}
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 120 {
		errs["name"] = "el nombre es obligatorio (máx. 120 caracteres)"
	}
	if in.TemplateID != uuid.Nil && in.CopyFromPlan != uuid.Nil {
		errs["source"] = "elige una plantilla o un plan a duplicar, no ambos"
	}
	if len(errs) > 0 {
		return PlanView{}, errs
	}
	if _, err := s.patients.Get(ctx, in.PatientID); err != nil {
		return PlanView{}, ValidationError{"patient_id": "el paciente no existe"}
	}
	if ok, err := s.patients.ConsentComplete(ctx, in.PatientID); err != nil {
		return PlanView{}, err
	} else if !ok {
		return PlanView{}, ErrConsentPending
	}
	targets := defaultTargets()
	if in.Targets != nil {
		targets = *in.Targets
	}
	days := blankDays(start, end)
	summary, evType := "Plan creado en blanco", "created"

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PlanView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	switch {
	case in.TemplateID != uuid.Nil:
		t, err := q.GetTemplate(ctx, in.TemplateID)
		if errors.Is(err, pgx.ErrNoRows) {
			return PlanView{}, ValidationError{"template_id": "la plantilla no existe"}
		}
		if err != nil {
			return PlanView{}, err
		}
		if t.PatientID.Valid && t.PatientID.UUID != in.PatientID {
			return PlanView{}, ValidationError{"template_id": "la plantilla es de otro paciente"}
		}
		var tdays []templateDay
		if err := json.Unmarshal(t.Structure, &tdays); err != nil || len(tdays) == 0 {
			return PlanView{}, ValidationError{"template_id": "la plantilla está vacía o dañada"}
		}
		for i := range days {
			td := tdays[i%len(tdays)]
			slots := make([]Slot, 0, len(td.Slots))
			for _, ts := range td.Slots {
				sl := Slot{ID: uuid.New(), Name: ts.Name, Items: []Item{}}
				for _, ti := range ts.Items {
					sl.Items = append(sl.Items, Item{ID: uuid.New(), DishID: ti.DishID, DishVersion: ti.DishVersion, Servings: ti.Servings, Instructions: ti.Instructions})
				}
				slots = append(slots, sl)
			}
			days[i].Slots = slots
		}
		summary = fmt.Sprintf("Plan creado desde la plantilla «%s» (copia independiente)", t.Name)
	case in.CopyFromPlan != uuid.Nil:
		src, err := q.GetPlan(ctx, in.CopyFromPlan)
		if errors.Is(err, pgx.ErrNoRows) {
			return PlanView{}, ValidationError{"copy_from_plan": "el plan a duplicar no existe"}
		}
		if err != nil {
			return PlanView{}, err
		}
		sdoc, err := s.docOf(ctx, q, src)
		if err != nil {
			return PlanView{}, err
		}
		shift := int(start.Sub(src.StartDate.Time).Hours() / 24)
		byDate := map[string]Day{}
		for _, d := range sdoc.Days {
			t, _ := parseDate(d.Date)
			byDate[t.AddDate(0, 0, shift).Format("2006-01-02")] = d
		}
		for i := range days {
			if d, ok := byDate[days[i].Date]; ok {
				days[i].Notes = d.Notes
				days[i].Slots = cloneSlots(d.Slots)
			}
		}
		if in.Targets == nil {
			targets = sdoc.Targets
		}
		summary, evType = fmt.Sprintf("Plan duplicado de «%s» (independiente del original)", src.Name), "duplicated"
	}

	doc := Document{Name: strings.TrimSpace(in.Name), Targets: targets, Days: days}
	if errs := validate(&doc); len(errs) > 0 {
		return PlanView{}, errs
	}
	p, err := q.InsertPlan(ctx, db.InsertPlanParams{PatientID: in.PatientID, Name: doc.Name, StartDate: pgDate(start), EndDate: pgDate(end),
		TargetEnergy: targets.Energy, TargetProtein: targets.Protein, TargetCarbs: targets.Carbs, TargetLipids: targets.Lipids, TargetEquivalents: eqJSON(targets.Equivalents), CreatedBy: a.ID})
	if err != nil {
		return PlanView{}, err
	}
	if err := s.writeDoc(ctx, q, p.ID, doc); err != nil {
		return PlanView{}, err
	}
	if err := s.event(ctx, q, p.ID, a, evType, summary); err != nil {
		return PlanView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PlanView{}, err
	}
	s.rec(ctx, a, "plan.create", p.ID, nil)
	return s.view(ctx, p)
}

// Save guarda el documento con concurrencia optimista (§9.3). Si la revisión esperada no coincide devuelve
// ConflictError con la versión vigente: nunca se sobrescribe en silencio.
func (s *Service) Save(ctx context.Context, a Actor, id uuid.UUID, expected int32, doc Document) (PlanView, error) {
	if errs := validate(&doc); len(errs) > 0 {
		return PlanView{}, errs
	}
	cur, err := s.q.GetPlan(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return PlanView{}, ErrNotFound
	}
	if err != nil {
		return PlanView{}, err
	}
	if readOnly(cur.Status) {
		return PlanView{}, ErrReadOnly
	}
	lo, hi := span(doc)
	tv := cur.TargetsVersion
	if !targetsEqual(targetsOf(cur), doc.Targets) {
		tv++
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PlanView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	p, err := q.UpdatePlanDoc(ctx, db.UpdatePlanDocParams{
		ID: id, Revision: expected, Name: strings.TrimSpace(doc.Name), StartDate: pgDate(lo), EndDate: pgDate(hi),
		TargetEnergy: doc.Targets.Energy, TargetProtein: doc.Targets.Protein, TargetCarbs: doc.Targets.Carbs, TargetLipids: doc.Targets.Lipids,
		TargetEquivalents: eqJSON(doc.Targets.Equivalents), TargetsVersion: tv, UpdatedBy: a.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		_ = tx.Rollback(ctx)
		latest, gerr := s.q.GetPlan(ctx, id)
		if gerr != nil {
			return PlanView{}, ErrNotFound
		}
		v, verr := s.view(ctx, latest)
		if verr != nil {
			return PlanView{}, verr
		}
		return PlanView{}, ConflictError{Current: v}
	}
	if err != nil {
		return PlanView{}, err
	}
	if err := s.writeDoc(ctx, q, id, doc); err != nil {
		return PlanView{}, err
	}
	// Eventos de edición agrupados para no inundar el historial.
	if last, err := q.LastPlanEvent(ctx, id); err == nil && last.Type == "edited" && time.Since(last.At.Time) < 15*time.Minute {
		if err := q.TouchPlanEvent(ctx, last.ID); err != nil {
			return PlanView{}, err
		}
	} else if err := s.event(ctx, q, id, a, "edited", "Editó el menú"); err != nil {
		return PlanView{}, err
	}
	// Un plan publicado se ve de inmediato: se conserva la revisión exacta de lo visible.
	if p.Status == "published" {
		if err := s.snapshot(ctx, q, p, a.ID); err != nil {
			return PlanView{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return PlanView{}, err
	}
	s.rec(ctx, a, "plan.save", id, map[string]any{"revision": p.Revision})
	return s.view(ctx, p)
}

func targetsEqual(a, b Targets) bool {
	if !a.Energy.Equal(b.Energy) || !a.Protein.Equal(b.Protein) || !a.Carbs.Equal(b.Carbs) || !a.Lipids.Equal(b.Lipids) {
		return false
	}
	pos := func(m map[string]decimal.Decimal) map[string]decimal.Decimal {
		o := map[string]decimal.Decimal{}
		for k, v := range m {
			if v.Sign() > 0 {
				o[k] = v
			}
		}
		return o
	}
	x, y := pos(a.Equivalents), pos(b.Equivalents)
	if len(x) != len(y) {
		return false
	}
	for k, v := range x {
		if o, ok := y[k]; !ok || !o.Equal(v) {
			return false
		}
	}
	return true
}

// ---------- Ciclo de vida (§11) ----------
type transition struct {
	from  []string
	to    string
	event string
	label string
}

var transitions = map[string]transition{
	"publish":   {[]string{"draft"}, "published", "published", "Publicado"},
	"unpublish": {[]string{"published"}, "draft", "unpublished", "Regresó a borrador (deja de ser visible para el paciente)"},
	"finalize":  {[]string{"published"}, "finished", "finished", "Finalizado manualmente"},
	"archive":   {[]string{"finished"}, "archived", "archived", "Archivado"},
	"restore":   {[]string{"archived"}, "finished", "restored", "Restaurado desde el archivo"},
}

func (s *Service) Transition(ctx context.Context, a Actor, id uuid.UUID, action, summary string) (PlanView, error) {
	tr, ok := transitions[action]
	if !ok {
		return PlanView{}, ValidationError{"action": "acción desconocida"}
	}
	cur, err := s.q.GetPlan(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return PlanView{}, ErrNotFound
	}
	if err != nil {
		return PlanView{}, err
	}
	allowed := false
	for _, f := range tr.from {
		allowed = allowed || f == cur.Status
	}
	if !allowed {
		return PlanView{}, ErrBadTransition
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PlanView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if action == "publish" {
		doc, err := s.docOf(ctx, q, cur)
		if err != nil {
			return PlanView{}, err
		}
		n := 0
		for _, d := range doc.Days {
			for _, sl := range d.Slots {
				n += len(sl.Items)
			}
		}
		if n == 0 {
			return PlanView{}, ErrEmptyPlan
		}
	}
	p, err := q.SetPlanStatus(ctx, db.SetPlanStatusParams{ID: id, Status: tr.to, UpdatedBy: a.ID})
	if err != nil {
		return PlanView{}, err
	}
	evSummary := tr.label
	if action == "publish" {
		if err := s.snapshot(ctx, q, p, a.ID); err != nil {
			return PlanView{}, err
		}
		pub, err := q.InsertPublication(ctx, db.InsertPublicationParams{PlanID: id, Revision: p.Revision, PublishedBy: a.ID, Summary: strings.TrimSpace(summary)})
		if err != nil {
			return PlanView{}, err
		}
		evSummary = fmt.Sprintf("Publicado como versión %d", pub.VersionNumber)
	}
	if err := s.event(ctx, q, id, a, tr.event, evSummary); err != nil {
		return PlanView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PlanView{}, err
	}
	s.rec(ctx, a, "plan."+action, id, nil)
	return s.view(ctx, p)
}

// Delete elimina de forma lógica solo borradores; lo publicado se finaliza o archiva (§17.2).
func (s *Service) Delete(ctx context.Context, a Actor, id uuid.UUID) error {
	cur, err := s.q.GetPlan(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if cur.Status != "draft" {
		return ErrBadTransition
	}
	if err := s.q.SoftDeletePlan(ctx, db.SoftDeletePlanParams{ID: id, UpdatedBy: a.ID}); err != nil {
		return err
	}
	_ = s.q.InsertPlanEvent(ctx, db.InsertPlanEventParams{PlanID: id, Actor: uuid.NullUUID{UUID: a.ID, Valid: true}, Type: "deleted", Summary: "Eliminado (lógicamente)"})
	s.rec(ctx, a, "plan.delete", id, nil)
	return nil
}

// ---------- Sustituciones (§8) ----------
type SubstituteInput struct {
	ItemID      uuid.UUID
	DishID      uuid.UUID
	DishVersion int32 // 0 = vigente
	Reason      string
}

// Substitute reemplaza al instante el platillo visible; el anterior queda en el historial con responsable,
// fecha y versiones. Los seguimientos previos siguen ligados al elemento y versión originales (§8).
func (s *Service) Substitute(ctx context.Context, a Actor, planID uuid.UUID, in SubstituteInput) (PlanView, error) {
	cur, err := s.q.GetPlan(ctx, planID)
	if errors.Is(err, pgx.ErrNoRows) {
		return PlanView{}, ErrNotFound
	}
	if err != nil {
		return PlanView{}, err
	}
	if readOnly(cur.Status) {
		return PlanView{}, ErrReadOnly
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PlanView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	old, err := q.GetItemForSubstitution(ctx, db.GetItemForSubstitutionParams{ID: in.ItemID, PlanID: planID})
	if errors.Is(err, pgx.ErrNoRows) {
		return PlanView{}, ErrNotFound
	}
	if err != nil {
		return PlanView{}, err
	}
	nd, err := q.GetDishForPlan(ctx, in.DishID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && nd.Status != "active") {
		return PlanView{}, ValidationError{"dish_id": "el platillo sustituto no existe o está inactivo"}
	}
	if err != nil {
		return PlanView{}, err
	}
	ver := in.DishVersion
	if ver == 0 {
		ver = nd.CurrentVersion
	}
	od, err := q.GetDishForPlan(ctx, old.DishID)
	if err != nil {
		return PlanView{}, err
	}
	newID := uuid.New()
	if err := q.RemoveItem(ctx, old.ID); err != nil {
		return PlanView{}, err
	}
	if err := q.InsertItem(ctx, db.InsertItemParams{ID: newID, SlotID: old.SlotID, Position: old.Position, DishID: in.DishID, DishVersion: ver, Servings: old.Servings, Instructions: old.Instructions}); err != nil {
		return PlanView{}, ValidationError{"dish_version": "la versión del platillo no existe"}
	}
	p, err := q.BumpPlanRevision(ctx, db.BumpPlanRevisionParams{ID: planID, UpdatedBy: a.ID})
	if err != nil {
		return PlanView{}, err
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" {
		reason = "sin especificar"
	}
	summary := fmt.Sprintf("%s v%d → %s v%d (%s, %s). Motivo: %s", od.Name, old.DishVersion, nd.Name, ver, old.PlanDate.Time.Format("2006-01-02"), old.SlotName, reason)
	if err := s.event(ctx, q, planID, a, "substitution", summary); err != nil {
		return PlanView{}, err
	}
	if p.Status == "published" {
		if err := s.snapshot(ctx, q, p, a.ID); err != nil {
			return PlanView{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return PlanView{}, err
	}
	s.rec(ctx, a, "plan.substitution", planID, nil)
	return s.view(ctx, p)
}
