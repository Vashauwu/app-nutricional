package smae

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/generated/db"
)

type PortionInput struct {
	Name            string
	Unit            string
	Quantity        decimal.Decimal
	GramsEquivalent decimal.Decimal
}

type CustomInput struct {
	Name, Brand, Description       string
	BasisQuantity                  decimal.Decimal
	BasisUnit                      string
	Energy, Protein, Carbs, Lipids decimal.Decimal
	Fiber                          decimal.Decimal
	DensityGPerMl                  *decimal.Decimal
	SourceType, SourceReference    string
	Tags                           []string
	Portions                       []PortionInput
}

func (in CustomInput) validate() ValidationError {
	errs := ValidationError{}
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 200 {
		errs["name"] = "el nombre es obligatorio (máx. 200 caracteres)"
	}
	if in.BasisQuantity.Sign() <= 0 {
		errs["basis_quantity"] = "la cantidad base debe ser mayor a cero"
	}
	if in.BasisUnit != "g" && in.BasisUnit != "ml" {
		errs["basis_unit"] = "la unidad base debe ser g o ml"
	}
	for k, v := range map[string]decimal.Decimal{"energy_kcal": in.Energy, "protein_g": in.Protein, "carbohydrates_g": in.Carbs, "lipids_g": in.Lipids, "fiber_g": in.Fiber} {
		if v.IsNegative() {
			errs[k] = "no puede ser negativo"
		}
	}
	switch in.SourceType {
	case "label", "manufacturer", "analysis", "manual", "other":
	default:
		errs["source_type"] = "tipo de fuente no válido"
	}
	if strings.TrimSpace(in.SourceReference) == "" {
		errs["source_reference"] = "indica la fuente de los valores"
	}
	if in.DensityGPerMl != nil && in.DensityGPerMl.Sign() <= 0 {
		errs["density_g_per_ml"] = "la densidad debe ser mayor a cero"
	}
	if in.BasisUnit == "ml" && in.DensityGPerMl == nil {
		errs["density_g_per_ml"] = "una base en ml requiere densidad"
	}
	units := map[string]bool{}
	for _, p := range in.Portions {
		if p.Unit == "" || p.Unit == "g" || p.Unit == "ml" || units[p.Unit] || p.Quantity.Sign() <= 0 || p.GramsEquivalent.Sign() <= 0 || strings.TrimSpace(p.Name) == "" {
			errs["portions"] = "medidas caseras inválidas, repetidas o con unidad reservada (g, ml)"
			break
		}
		units[p.Unit] = true
	}
	return errs
}

func nullDecimal(d *decimal.Decimal) decimal.NullDecimal {
	if d == nil {
		return decimal.NullDecimal{}
	}
	return decimal.NullDecimal{Decimal: *d, Valid: true}
}

func (s *Service) CreateCustom(ctx context.Context, a Actor, in CustomInput) (Food, error) {
	if e := in.validate(); len(e) > 0 {
		return Food{}, e
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Food{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	c, err := q.InsertCustomFood(ctx, db.InsertCustomFoodParams{
		Name: strings.TrimSpace(in.Name), Brand: pgtype.Text{String: in.Brand, Valid: strings.TrimSpace(in.Brand) != ""}, Description: in.Description, BasisQuantity: in.BasisQuantity,
		BasisUnit: in.BasisUnit, DensityGPerMl: nullDecimal(in.DensityGPerMl), EnergyKcal: in.Energy, ProteinG: in.Protein, CarbohydratesG: in.Carbs, LipidsG: in.Lipids, FiberG: in.Fiber,
		SourceType: in.SourceType, SourceReference: strings.TrimSpace(in.SourceReference), Tags: nilTags(in.Tags), CreatedBy: a.ID,
	})
	if err != nil {
		return Food{}, err
	}
	for _, p := range in.Portions {
		if err := q.InsertCustomPortion(ctx, db.InsertCustomPortionParams{CustomFoodID: c.ID, Name: p.Name, Unit: p.Unit, Quantity: p.Quantity, GramsEquivalent: p.GramsEquivalent}); err != nil {
			return Food{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Food{}, err
	}
	s.rec(ctx, a, "custom_food.create", "custom_food", c.ID, nil)
	return s.Resolve(ctx, "custom", c.ID)
}

// UpdateCustom edita los valores; la validación previa se invalida y la equivalencia asignada se conserva.
func (s *Service) UpdateCustom(ctx context.Context, a Actor, id uuid.UUID, in CustomInput) (Food, error) {
	if e := in.validate(); len(e) > 0 {
		return Food{}, e
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Food{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if _, err := q.UpdateCustomFood(ctx, db.UpdateCustomFoodParams{
		ID: id, Name: strings.TrimSpace(in.Name), Brand: pgtype.Text{String: in.Brand, Valid: strings.TrimSpace(in.Brand) != ""}, Description: in.Description, BasisQuantity: in.BasisQuantity,
		BasisUnit: in.BasisUnit, DensityGPerMl: nullDecimal(in.DensityGPerMl), EnergyKcal: in.Energy, ProteinG: in.Protein, CarbohydratesG: in.Carbs, LipidsG: in.Lipids, FiberG: in.Fiber,
		SourceType: in.SourceType, SourceReference: strings.TrimSpace(in.SourceReference), Tags: nilTags(in.Tags),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Food{}, ErrNotFound
		}
		return Food{}, err
	}
	if err := q.DeleteCustomPortions(ctx, id); err != nil {
		return Food{}, err
	}
	for _, p := range in.Portions {
		if err := q.InsertCustomPortion(ctx, db.InsertCustomPortionParams{CustomFoodID: id, Name: p.Name, Unit: p.Unit, Quantity: p.Quantity, GramsEquivalent: p.GramsEquivalent}); err != nil {
			return Food{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Food{}, err
	}
	s.rec(ctx, a, "custom_food.update", "custom_food", id, nil)
	return s.Resolve(ctx, "custom", id)
}

func (s *Service) ListCustom(ctx context.Context, search string, includeInactive bool, limit, offset int) (FoodsPage, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	rows, err := s.q.ListCustomFoods(ctx, db.ListCustomFoodsParams{OnlyActive: !includeInactive, Search: escapeLike(search), PageLimit: int32(limit), PageOffset: int32(offset)})
	if err != nil {
		return FoodsPage{}, err
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	ps, err := s.q.ListCustomPortionsFor(ctx, ids)
	if err != nil {
		return FoodsPage{}, err
	}
	by := map[uuid.UUID][]db.CustomFoodPortion{}
	for _, p := range ps {
		by[p.CustomFoodID] = append(by[p.CustomFoodID], p)
	}
	out := FoodsPage{Items: []Food{}, Limit: limit, Offset: offset}
	for _, r := range rows {
		out.Total = r.Total
		out.Items = append(out.Items, customFood(customRow(r), by[r.ID]))
	}
	return out, nil
}

func (s *Service) ValidateCustom(ctx context.Context, a Actor, id uuid.UUID) error {
	if _, err := s.q.GetCustomFood(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if err := s.q.ValidateCustomFood(ctx, db.ValidateCustomFoodParams{ID: id, ValidatedBy: uuid.NullUUID{UUID: a.ID, Valid: true}}); err != nil {
		return err
	}
	s.rec(ctx, a, "custom_food.validate", "custom_food", id, nil)
	return nil
}

// AssignEquivalence: solo existe equivalencia SMAE si la nutrióloga la asigna de forma expresa (§30.3).
func (s *Service) AssignEquivalence(ctx context.Context, a Actor, id uuid.UUID, subgroupCode string, refGrams decimal.Decimal, criterion string) error {
	errs := ValidationError{}
	if refGrams.Sign() <= 0 {
		errs["reference_grams"] = "debe ser mayor a cero"
	}
	if len(strings.TrimSpace(criterion)) < 10 {
		errs["criterion"] = "describe el criterio (mínimo 10 caracteres)"
	}
	ed, err := s.ActiveEdition(ctx)
	if err != nil {
		return err
	}
	subs, err := s.q.ListSubgroups(ctx, ed.ID)
	if err != nil {
		return err
	}
	found := false
	for _, sg := range subs {
		if sg.Code == subgroupCode {
			found = true
		}
	}
	if !found {
		errs["subgroup_code"] = "subgrupo inexistente en la edición activa"
	}
	if len(errs) > 0 {
		return errs
	}
	if _, err := s.q.GetCustomFood(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if err := s.q.AssignCustomEquivalence(ctx, db.AssignCustomEquivalenceParams{
		ID: id, EqSubgroupCode: pgtype.Text{String: subgroupCode, Valid: true}, EqReferenceGrams: decimal.NullDecimal{Decimal: refGrams, Valid: true},
		EqAssignedBy: uuid.NullUUID{UUID: a.ID, Valid: true}, EqCriterion: pgtype.Text{String: strings.TrimSpace(criterion), Valid: true},
	}); err != nil {
		return err
	}
	s.rec(ctx, a, "custom_food.equivalence", "custom_food", id, map[string]any{"subgroup": subgroupCode})
	return nil
}

func (s *Service) SetCustomActive(ctx context.Context, a Actor, id uuid.UUID, active bool) error {
	if _, err := s.q.GetCustomFood(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	st := "inactive"
	if active {
		st = "active"
	}
	if err := s.q.SetCustomFoodStatus(ctx, db.SetCustomFoodStatusParams{ID: id, Status: st}); err != nil {
		return err
	}
	s.rec(ctx, a, "custom_food.status", "custom_food", id, map[string]any{"status": st})
	return nil
}
