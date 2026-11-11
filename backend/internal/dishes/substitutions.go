package dishes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/nutrition_engine/calculator"
	"github.com/nutri/app-nutricional/backend/internal/patients"
)

// ClinicalReader da acceso a alergias y restricciones para revisar sustituciones (lo implementa patients.Service).
type ClinicalReader interface {
	Clinical(ctx context.Context, patient uuid.UUID) (patients.Clinical, error)
}

func (s *Service) SetClinical(c ClinicalReader) { s.clinical = c }

var accentless = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n")

func norm(s string) string { return accentless.Replace(strings.ToLower(strings.TrimSpace(s))) }

func containsAny(words []string, needle string) bool {
	n := norm(needle)
	if len(n) < 3 {
		return false
	}
	for _, w := range words {
		if strings.Contains(norm(w), n) {
			return true
		}
	}
	return false
}

type Candidate struct {
	DishID          uuid.UUID            `json:"dish_id"`
	Name            string               `json:"name"`
	Version         int32                `json:"version"`
	Diff            calculator.Nutrients `json:"diff"`
	SameEquivalents bool                 `json:"same_equivalents"`
	Conflicts       []string             `json:"conflicts"`
	Reason          string               `json:"reason"`
}

func diffN(a, b calculator.Nutrients) calculator.Nutrients {
	return calculator.Nutrients{EnergyKcal: a.EnergyKcal.Sub(b.EnergyKcal), ProteinG: a.ProteinG.Sub(b.ProteinG), CarbohydratesG: a.CarbohydratesG.Sub(b.CarbohydratesG),
		LipidsG: a.LipidsG.Sub(b.LipidsG), FiberG: a.FiberG.Sub(b.FiberG)}
}

func sameEq(a, b map[string]decimal.Decimal) bool {
	half := decimal.RequireFromString("0.5")
	keys := map[string]bool{}
	for k := range a {
		keys[k] = true
	}
	for k := range b {
		keys[k] = true
	}
	for k := range keys {
		if a[k].Sub(b[k]).Abs().GreaterThan(half) {
			return false
		}
	}
	return true
}

func (s *Service) conflictsFor(ctx context.Context, clin patients.Clinical, dishID uuid.UUID, versionID uuid.UUID, name string, tags []string) ([]string, error) {
	ings, err := s.q.ListIngredients(ctx, versionID)
	if err != nil {
		return nil, err
	}
	words := append([]string{name}, tags...)
	for _, i := range ings {
		words = append(words, i.NameSnapshot)
	}
	var out []string
	for _, al := range clin.Allergies {
		if al.Status != "active" {
			continue
		}
		for _, t := range append([]string{al.Allergen}, al.Aliases...) {
			if containsAny(words, t) {
				out = append(out, "Alergia: "+al.Allergen)
				break
			}
		}
	}
	for _, p := range clin.Preferences {
		if (p.PreferenceType == "avoid" || p.PreferenceType == "restriction") && containsAny(words, p.FoodName) {
			label := "No consume"
			if p.PreferenceType == "restriction" {
				label = "Restricción"
			}
			out = append(out, label+": "+p.FoodName)
		}
	}
	_ = dishID
	return out, nil
}

// Candidates sugiere sustitutos: misma categoría y energía similar (±20 %). Son orientativos: la nutrióloga
// revisa y autoriza cada uno (§8, §30.8). Con patientID se marcan alergias y restricciones.
func (s *Service) Candidates(ctx context.Context, dishID uuid.UUID, patientID uuid.UUID) ([]Candidate, error) {
	base, err := s.q.GetDish(ctx, dishID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	bv, err := s.q.GetDishVersion(ctx, db.GetDishVersionParams{DishID: dishID, VersionNumber: base.CurrentVersion})
	if err != nil {
		return nil, err
	}
	bs, err := s.q.GetSnapshot(ctx, bv.ID)
	if err != nil {
		return nil, err
	}
	baseN := nutritionDTO(bs)
	var clin patients.Clinical
	if patientID != uuid.Nil && s.clinical != nil {
		if clin, err = s.clinical.Clinical(ctx, patientID); err != nil {
			return nil, err
		}
	}
	rows, err := s.q.ListDishes(ctx, db.ListDishesParams{Status: "active", Category: base.Category, PageLimit: 100})
	if err != nil {
		return nil, err
	}
	type scored struct {
		c     Candidate
		ratio decimal.Decimal
	}
	var list []scored
	limit := decimal.RequireFromString("0.2")
	for _, r := range rows {
		if r.ID == dishID {
			continue
		}
		diff := diffN(rowServing(r), baseN.PerServing)
		ratio := decimal.Zero
		if baseN.PerServing.EnergyKcal.Sign() > 0 {
			q, err := calculator.Div(diff.EnergyKcal.Abs(), baseN.PerServing.EnergyKcal)
			if err != nil {
				return nil, err
			}
			ratio = q
		}
		if ratio.GreaterThan(limit) {
			continue
		}
		cv, err := s.q.GetDishVersion(ctx, db.GetDishVersionParams{DishID: r.ID, VersionNumber: r.CurrentVersion})
		if err != nil {
			return nil, err
		}
		conf, err := s.conflictsFor(ctx, clin, r.ID, cv.ID, r.Name, r.Tags)
		if err != nil {
			return nil, err
		}
		same := sameEq(baseN.Equivalents, parseEq(r.Equivalents))
		reason := fmt.Sprintf("Misma categoría (%s) y energía dentro de ±%s %%", base.Category, ratio.Mul(decimal.NewFromInt(100)).Round(0).Add(decimal.Zero))
		if same {
			reason += "; mismos equivalentes SMAE"
		} else {
			reason += "; equivalentes distintos, revisa la diferencia"
		}
		if conf == nil {
			conf = []string{}
		}
		list = append(list, scored{Candidate{DishID: r.ID, Name: r.Name, Version: r.CurrentVersion, Diff: diff, SameEquivalents: same, Conflicts: conf, Reason: reason}, ratio})
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].ratio.LessThan(list[j].ratio) })
	out := []Candidate{}
	for i, x := range list {
		if i == 8 {
			break
		}
		out = append(out, x.c)
	}
	return out, nil
}

// AddSubstitution autoriza una alternativa. La diferencia nutricional la calcula el servidor.
func (s *Service) AddSubstitution(ctx context.Context, a Actor, dishID uuid.UUID, version int32, substituteID uuid.UUID, note string) (SubstitutionDTO, error) {
	if substituteID == dishID {
		return SubstitutionDTO{}, ValidationError{"substitute_dish_id": "un platillo no puede sustituirse a sí mismo"}
	}
	base, err := s.q.GetDish(ctx, dishID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SubstitutionDTO{}, ErrNotFound
	}
	if err != nil {
		return SubstitutionDTO{}, err
	}
	if version == 0 {
		version = base.CurrentVersion
	}
	bv, err := s.q.GetDishVersion(ctx, db.GetDishVersionParams{DishID: dishID, VersionNumber: version})
	if errors.Is(err, pgx.ErrNoRows) {
		return SubstitutionDTO{}, ErrNotFound
	}
	if err != nil {
		return SubstitutionDTO{}, err
	}
	sub, err := s.q.GetDish(ctx, substituteID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && sub.Status != "active") {
		return SubstitutionDTO{}, ValidationError{"substitute_dish_id": "el platillo sustituto no existe o está inactivo"}
	}
	if err != nil {
		return SubstitutionDTO{}, err
	}
	sv, err := s.q.GetDishVersion(ctx, db.GetDishVersionParams{DishID: substituteID, VersionNumber: sub.CurrentVersion})
	if err != nil {
		return SubstitutionDTO{}, err
	}
	bs, err := s.q.GetSnapshot(ctx, bv.ID)
	if err != nil {
		return SubstitutionDTO{}, err
	}
	ss, err := s.q.GetSnapshot(ctx, sv.ID)
	if err != nil {
		return SubstitutionDTO{}, err
	}
	diff, _ := json.Marshal(diffN(nutritionDTO(ss).PerServing, nutritionDTO(bs).PerServing))
	row, err := s.q.InsertSubstitution(ctx, db.InsertSubstitutionParams{
		DishVersionID: bv.ID, SubstituteDishID: substituteID, SubstituteVersion: sub.CurrentVersion, Label: sub.Name, Note: strings.TrimSpace(note),
		Rule: "Autorizado por la nutrióloga tras revisar la diferencia nutricional", Diff: diff, ApprovedBy: a.ID,
	})
	if err != nil {
		return SubstitutionDTO{}, err
	}
	s.rec(ctx, a, "dish.substitution", dishID, map[string]any{"substitute": substituteID})
	return SubstitutionDTO{ID: row.ID, DishID: row.SubstituteDishID, DishVersion: row.SubstituteVersion, Label: row.Label, Note: row.Note, Rule: row.Rule, Diff: row.Diff, ApprovedAt: row.ApprovedAt.Time}, nil
}

func (s *Service) RemoveSubstitution(ctx context.Context, a Actor, dishID uuid.UUID, version int32, subID uuid.UUID) error {
	d, err := s.q.GetDish(ctx, dishID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if version == 0 {
		version = d.CurrentVersion
	}
	v, err := s.q.GetDishVersion(ctx, db.GetDishVersionParams{DishID: dishID, VersionNumber: version})
	if err != nil {
		return ErrNotFound
	}
	n, err := s.q.RemoveSubstitution(ctx, db.RemoveSubstitutionParams{ID: subID, DishVersionID: v.ID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.rec(ctx, a, "dish.substitution_removed", dishID, nil)
	return nil
}
