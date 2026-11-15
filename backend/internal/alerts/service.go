// Package alerts evalúa alertas nutricionales sobre un plan (MVP_SPEC §14): alergias, alimentos restringidos,
// conflictos con indicaciones clínicas y desviaciones frente a los objetivos. Las alertas APOYAN la revisión
// profesional: nunca bloquean la publicación y cada una explica su motivo y el dato que la originó.
package alerts

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/mealplans"
	"github.com/nutri/app-nutricional/backend/internal/nutrition_engine/calculator"
	"github.com/nutri/app-nutricional/backend/internal/settings"
)

var ErrNotFound = errors.New("no encontrado")

type Alert struct {
	ID        string    `json:"id"`
	Level     string    `json:"level"` // critical | warning | info
	Kind      string    `json:"kind"`  // allergy | restriction | clinical | energy | macro
	Title     string    `json:"title"`
	Reason    string    `json:"reason"`
	Source    string    `json:"source"`
	PatientID uuid.UUID `json:"patient_id"`
	PlanID    uuid.UUID `json:"plan_id"`
	Date      string    `json:"date,omitempty"`
	SlotName  string    `json:"slot_name,omitempty"`
}

type Plans interface {
	Get(ctx context.Context, id uuid.UUID) (mealplans.PlanView, error)
	// GetNoFinalize lee el plan sin intentar finalizar planes vencidos: para lotes que ya lo hicieron una vez.
	GetNoFinalize(ctx context.Context, id uuid.UUID) (mealplans.PlanView, error)
	FinalizeExpired(ctx context.Context) error
}

type Settings interface {
	Get(ctx context.Context) (settings.All, error)
}

type Service struct {
	q        *db.Queries
	plans    Plans
	settings Settings
}

func NewService(pool db.DBTX, p Plans, s Settings) *Service {
	return &Service{q: db.New(pool), plans: p, settings: s}
}

var stripMarks = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// normalize minúsculas y sin acentos, para comparar «Cacahuate» con «cacahuaté».
func normalize(s string) string {
	out, _, err := transform.String(stripMarks, strings.ToLower(s))
	if err != nil {
		return strings.ToLower(s)
	}
	return strings.TrimSpace(out)
}

// matches evita falsos positivos por términos muy cortos (mínimo 3 letras).
func matches(haystack []string, needle string) (string, bool) {
	n := normalize(needle)
	if len([]rune(n)) < 3 {
		return "", false
	}
	for _, h := range haystack {
		if strings.Contains(normalize(h), n) {
			return needle, true
		}
	}
	return "", false
}

var severityEs = map[string]string{"severe": "severa", "moderate": "moderada", "mild": "leve"}
var rank = map[string]int{"critical": 0, "warning": 1, "info": 2}

// patientData reúne lo que se consulta una sola vez por paciente.
type patientData struct {
	allergies   []db.PatientAllergy
	prefs       []db.PatientFoodPreference
	indications string
}

// batch comparte lecturas entre los planes de un mismo cálculo (evita consultas N+1 en el tablero):
// la configuración, los datos de cada paciente y los nombres de ingredientes por versión de platillo.
type batch struct {
	cfg      *settings.All
	patients map[uuid.UUID]*patientData
	ings     map[string][]string
}

func newBatch() *batch {
	return &batch{patients: map[uuid.UUID]*patientData{}, ings: map[string][]string{}}
}

func (s *Service) config(ctx context.Context, b *batch) (settings.All, error) {
	if b.cfg != nil {
		return *b.cfg, nil
	}
	cfg, err := s.settings.Get(ctx)
	if err != nil {
		return settings.All{}, err
	}
	b.cfg = &cfg
	return cfg, nil
}

func (s *Service) patientData(ctx context.Context, b *batch, id uuid.UUID) (*patientData, error) {
	if d, ok := b.patients[id]; ok {
		return d, nil
	}
	allergies, err := s.q.ListAllergies(ctx, id)
	if err != nil {
		return nil, err
	}
	prefs, err := s.q.ListPreferences(ctx, id)
	if err != nil {
		return nil, err
	}
	conds, err := s.q.ListConditions(ctx, id)
	if err != nil {
		return nil, err
	}
	indicationsText, err := s.q.GetPatientIndications(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	parts := []string{indicationsText}
	for _, c := range conds {
		if c.Status == "active" {
			parts = append(parts, c.Name+" "+c.Details)
		}
	}
	d := &patientData{allergies: allergies, prefs: prefs, indications: normalize(strings.Join(parts, " "))}
	b.patients[id] = d
	return d, nil
}

// ForPlan evalúa un plan completo.
func (s *Service) ForPlan(ctx context.Context, planID uuid.UUID) ([]Alert, error) {
	plan, err := s.plans.Get(ctx, planID)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.evaluate(ctx, plan, newBatch())
}

func (s *Service) evaluate(ctx context.Context, plan mealplans.PlanView, b *batch) ([]Alert, error) {
	cfg, err := s.config(ctx, b)
	if err != nil {
		return nil, err
	}
	pd, err := s.patientData(ctx, b, plan.PatientID)
	if err != nil {
		return nil, err
	}
	allergies, prefs, indications := pd.allergies, pd.prefs, pd.indications

	var out []Alert
	seen := map[string]bool{}
	push := func(a Alert) {
		if !seen[a.ID] {
			seen[a.ID] = true
			a.PatientID, a.PlanID = plan.PatientID, plan.ID
			out = append(out, a)
		}
	}
	ingCache := b.ings
	ingredients := func(dish uuid.UUID, v int32) ([]string, error) {
		k := fmt.Sprintf("%s:%d", dish, v)
		if n, ok := ingCache[k]; ok {
			return n, nil
		}
		n, err := s.q.IngredientNames(ctx, db.IngredientNamesParams{DishID: dish, VersionNumber: v})
		if err != nil {
			return nil, err
		}
		ingCache[k] = n
		return n, nil
	}

	for _, day := range plan.Days {
		for _, slot := range day.Slots {
			for _, it := range slot.Items {
				ings, err := ingredients(it.DishID, it.DishVersion)
				if err != nil {
					return nil, err
				}
				words := append([]string{it.DishName}, ings...)
				where := it.DishName + " · " + slot.Name
				for _, a := range allergies {
					if a.Status != "active" {
						continue
					}
					for _, term := range append([]string{a.Allergen}, a.Aliases...) {
						if hit, ok := matches(words, term); ok {
							src := "Alergia registrada: " + a.Allergen
							if a.Reaction != "" {
								src += " — " + a.Reaction
							}
							push(Alert{ID: fmt.Sprintf("allergy:%s:%s:%s:%s", day.Date, slot.ID, it.ID, a.ID), Level: "critical", Kind: "allergy",
								Title:  "Posible alérgeno: " + a.Allergen,
								Reason: fmt.Sprintf(`"%s" contiene o menciona "%s", registrado como alergia (%s).`, where, hit, severityEs[a.Severity]),
								Source: src, Date: day.Date, SlotName: slot.Name})
							break
						}
					}
				}
				for _, p := range prefs {
					if p.PreferenceType != "avoid" && p.PreferenceType != "restriction" {
						continue
					}
					if _, ok := matches(words, p.FoodName); ok {
						title := "Restricción: " + p.FoodName
						if p.PreferenceType == "avoid" {
							title = "Alimento que no consume: " + p.FoodName
						}
						src := "Preferencia registrada"
						if p.Notes != "" {
							src += ": " + p.Notes
						}
						push(Alert{ID: fmt.Sprintf("avoid:%s:%s:%s:%s", day.Date, slot.ID, it.ID, p.ID), Level: "warning", Kind: "restriction", Title: title,
							Reason: fmt.Sprintf(`"%s" incluye "%s".`, where, p.FoodName), Source: src, Date: day.Date, SlotName: slot.Name})
					}
				}
				for _, r := range cfg.Alerts.ClinicalRules {
					if !r.Enabled || !strings.Contains(indications, normalize(r.Keyword)) {
						continue
					}
					for _, t := range r.Triggers {
						if hit, ok := matches(words, t); ok {
							push(Alert{ID: fmt.Sprintf("clin:%s:%s:%s:%s", day.Date, slot.ID, it.ID, r.ID), Level: r.Level, Kind: "clinical", Title: r.Message,
								Reason: fmt.Sprintf(`"%s" menciona "%s" y podría entrar en conflicto con la indicación clínica "%s".`, where, hit, r.Keyword),
								Source: "Regla clínica configurable (validada por la nutrióloga)", Date: day.Date, SlotName: slot.Name})
							break
						}
					}
				}
			}
		}
		// Desviaciones frente a los objetivos diarios.
		if !hasItems(day) {
			continue
		}
		n := day.Totals.Nutrients
		for _, m := range []struct {
			key, label, unit, kind string
			planned, target        decimal.Decimal
			tol                    decimal.Decimal
		}{
			{"energy", "Energía", "kcal", "energy", n.EnergyKcal, plan.Targets.Energy, cfg.Alerts.EnergyTolerancePct},
			{"protein", "Proteínas", "g", "macro", n.ProteinG, plan.Targets.Protein, cfg.Alerts.MacroTolerancePct},
			{"carbs", "Carbohidratos", "g", "macro", n.CarbohydratesG, plan.Targets.Carbs, cfg.Alerts.MacroTolerancePct},
			{"lipids", "Lípidos", "g", "macro", n.LipidsG, plan.Targets.Lipids, cfg.Alerts.MacroTolerancePct},
		} {
			if !m.target.IsPositive() {
				continue
			}
			ratio, err := calculator.Div(m.planned.Sub(m.target), m.target)
			if err != nil {
				continue
			}
			pct := ratio.Mul(decimal.NewFromInt(100))
			if pct.Abs().LessThanOrEqual(m.tol) {
				continue
			}
			level, dir := "warning", "por debajo"
			if pct.Abs().GreaterThan(m.tol.Mul(decimal.NewFromInt(2))) {
				level = "critical"
			}
			sign := ""
			if pct.IsPositive() {
				dir, sign = "por encima", "+"
			}
			push(Alert{ID: fmt.Sprintf("dev:%s:%s", day.Date, m.key), Level: level, Kind: m.kind, Title: fmt.Sprintf("%s %s del objetivo", m.label, dir),
				Reason: fmt.Sprintf("El día suma %s %s frente a un objetivo de %s %s (%s%s %%; tolerancia ±%s %%).",
					m.planned.Round(0), m.unit, m.target.Round(0), m.unit, sign, pct.Round(1), m.tol),
				Source: "Objetivos diarios del plan", Date: day.Date})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if rank[out[i].Level] != rank[out[j].Level] {
			return rank[out[i].Level] < rank[out[j].Level]
		}
		return out[i].Date < out[j].Date
	})
	if out == nil {
		out = []Alert{}
	}
	return out, nil
}

func hasItems(d mealplans.DayView) bool {
	for _, s := range d.Slots {
		if len(s.Items) > 0 {
			return true
		}
	}
	return false
}

// Summary agrupa las alertas de todos los planes publicados (tablero de la nutrióloga).
type Summary struct {
	Critical int     `json:"critical"`
	Warning  int     `json:"warning"`
	Info     int     `json:"info"`
	Items    []Alert `json:"items"`
}

func (s *Service) Published(ctx context.Context) (Summary, error) {
	// Se finaliza una sola vez y se comparten las lecturas entre planes: sin esto cada plan repetía
	// la actualización de vencidos, la configuración y los datos del paciente (consultas N+1).
	if err := s.plans.FinalizeExpired(ctx); err != nil {
		return Summary{}, err
	}
	ids, err := s.q.ListPublishedPlanIDs(ctx)
	if err != nil {
		return Summary{}, err
	}
	sum := Summary{Items: []Alert{}}
	b := newBatch()
	for _, id := range ids {
		plan, err := s.plans.GetNoFinalize(ctx, id)
		if err != nil {
			return Summary{}, ErrNotFound
		}
		list, err := s.evaluate(ctx, plan, b)
		if err != nil {
			return Summary{}, err
		}
		for _, a := range list {
			switch a.Level {
			case "critical":
				sum.Critical++
			case "warning":
				sum.Warning++
			default:
				sum.Info++
			}
			sum.Items = append(sum.Items, a)
		}
	}
	sort.SliceStable(sum.Items, func(i, j int) bool { return rank[sum.Items[i].Level] < rank[sum.Items[j].Level] })
	return sum, nil
}
