package dishes

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/nutrition_engine/calculator"
	"github.com/nutri/app-nutricional/backend/internal/smae"
)

var (
	ErrAlreadyDecided = errors.New("ya se registraron las decisiones de recálculo de esta edición")
	ErrEditionState   = errors.New("la edición no está en borrador")
)

// ImpactRow compara un platillo antes y después de incorporar una edición nueva (§7.4, §30.9).
type ImpactRow struct {
	DishID       uuid.UUID            `json:"dish_id"`
	Name         string               `json:"name"`
	FromVersion  int32                `json:"from_version"`
	ChangedFoods []string             `json:"changed_foods"`
	Before       calculator.Nutrients `json:"before"`
	After        calculator.Nutrients `json:"after"`
	Diff         calculator.Nutrients `json:"diff"`
	// Blocked explica por qué no se puede autorizar (p. ej. un alimento desapareció de la edición nueva).
	Blocked string `json:"blocked,omitempty"`

	rebuilt []db.InsertIngredientParams
	result  calculator.DishResult
	version db.ListCurrentDishVersionsRow
}

func sameFood(a, b smae.Food) bool {
	if !a.BasisQuantity.Equal(b.BasisQuantity) || a.BasisUnit != b.BasisUnit || !a.EnergyKcal.Equal(b.EnergyKcal) || !a.ProteinG.Equal(b.ProteinG) ||
		!a.CarbohydratesG.Equal(b.CarbohydratesG) || !a.LipidsG.Equal(b.LipidsG) || !a.FiberG.Equal(b.FiberG) {
		return false
	}
	if (a.Equivalence == nil) != (b.Equivalence == nil) {
		return false
	}
	if a.Equivalence != nil {
		return a.Equivalence.SubgroupCode == b.Equivalence.SubgroupCode && a.Equivalence.ReferenceGrams.Equal(b.Equivalence.ReferenceGrams) &&
			a.Equivalence.EquivalentValue.Equal(b.Equivalence.EquivalentValue)
	}
	return true
}

// Impact detecta los platillos afectados por la edición y calcula las diferencias, sin modificar nada.
func (s *Service) Impact(ctx context.Context, toEdition uuid.UUID) ([]ImpactRow, error) {
	if _, err := s.catalog.Edition(ctx, toEdition); err != nil {
		if errors.Is(err, smae.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	cur, err := s.q.ListCurrentDishVersions(ctx)
	if err != nil {
		return nil, err
	}
	rows := []ImpactRow{}
	for _, v := range cur {
		if v.SmaeEditionID == toEdition {
			continue
		}
		ings, err := s.q.ListIngredients(ctx, v.VersionID)
		if err != nil {
			return nil, err
		}
		row := ImpactRow{DishID: v.DishID, Name: v.Name, FromVersion: v.VersionNumber, ChangedFoods: []string{}, version: v}
		var results []calculator.IngredientResult
		for _, ing := range ings {
			var food smae.Food
			if ing.FoodKind == "smae" {
				old, err := s.catalog.Resolve(ctx, "smae", ing.FoodID)
				if err != nil {
					return nil, err
				}
				nf, err := s.catalog.ResolveByEditionCode(ctx, toEdition, old.Code)
				if errors.Is(err, smae.ErrNotFound) {
					row.Blocked = fmt.Sprintf("«%s» no existe en la edición nueva", old.Name)
					food = old
				} else if err != nil {
					return nil, err
				} else {
					food = nf
					if !sameFood(old, nf) {
						row.ChangedFoods = append(row.ChangedFoods, old.Name)
					}
				}
			} else {
				food, err = s.catalog.Resolve(ctx, "custom", ing.FoodID)
				if err != nil {
					return nil, err
				}
			}
			r, err := calculator.CalcIngredient(food.ToCalc(), ing.Quantity, ing.Unit)
			if err != nil {
				return nil, err
			}
			results = append(results, r)
			p := db.InsertIngredientParams{
				Position: ing.Position, FoodKind: ing.FoodKind, FoodID: food.ID, NameSnapshot: food.Name, Quantity: ing.Quantity, Unit: ing.Unit, Grams: r.Grams,
				EnergyKcal: r.Nutrients.EnergyKcal, ProteinG: r.Nutrients.ProteinG, CarbohydratesG: r.Nutrients.CarbohydratesG, LipidsG: r.Nutrients.LipidsG, FiberG: r.Nutrients.FiberG, Official: r.Official,
			}
			if r.HasEquivalent {
				p.EquivalentCode = pgtype.Text{String: r.EquivalentCode, Valid: true}
				p.EquivalentValue = decimal.NullDecimal{Decimal: r.EquivalentValue, Valid: true}
			}
			row.rebuilt = append(row.rebuilt, p)
		}
		if len(row.ChangedFoods) == 0 && row.Blocked == "" {
			continue
		}
		res, err := calculator.CalcDish(results, v.Servings)
		if err != nil {
			return nil, err
		}
		before, err := s.q.GetSnapshot(ctx, v.VersionID)
		if err != nil {
			return nil, err
		}
		row.result = res
		row.Before = calculator.Nutrients{EnergyKcal: before.ServingEnergy, ProteinG: before.ServingProtein, CarbohydratesG: before.ServingCarbs, LipidsG: before.ServingLipids, FiberG: before.ServingFiber}
		row.After = res.PerServing
		row.Diff = calculator.Nutrients{
			EnergyKcal: row.After.EnergyKcal.Sub(row.Before.EnergyKcal), ProteinG: row.After.ProteinG.Sub(row.Before.ProteinG), CarbohydratesG: row.After.CarbohydratesG.Sub(row.Before.CarbohydratesG),
			LipidsG: row.After.LipidsG.Sub(row.Before.LipidsG), FiberG: row.After.FiberG.Sub(row.Before.FiberG),
		}
		rows = append(rows, row)
	}
	return rows, nil
}

type Decision struct {
	DishID    uuid.UUID
	Authorize bool
}

type RecalcResult struct {
	BatchID    uuid.UUID `json:"batch_id"`
	Authorized int       `json:"authorized"`
	Rejected   int       `json:"rejected"`
}

// ApplyRecalc registra las decisiones de la nutrióloga. Cada autorización crea una versión nueva e inmutable;
// nunca se actualiza un platillo sin autorización (§7.4).
func (s *Service) ApplyRecalc(ctx context.Context, a Actor, toEdition uuid.UUID, decisions []Decision) (RecalcResult, error) {
	ed, err := s.catalog.Edition(ctx, toEdition)
	if err != nil {
		if errors.Is(err, smae.ErrNotFound) {
			return RecalcResult{}, ErrNotFound
		}
		return RecalcResult{}, err
	}
	if ed.Status != "draft" {
		return RecalcResult{}, ErrEditionState
	}
	if _, err := s.q.GetRecalcBatchForEdition(ctx, toEdition); err == nil {
		return RecalcResult{}, ErrAlreadyDecided
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return RecalcResult{}, err
	}
	rows, err := s.Impact(ctx, toEdition)
	if err != nil {
		return RecalcResult{}, err
	}
	byDish := map[uuid.UUID]*ImpactRow{}
	for i := range rows {
		byDish[rows[i].DishID] = &rows[i]
	}
	decided := map[uuid.UUID]bool{}
	errs := ValidationError{}
	for _, d := range decisions {
		row, ok := byDish[d.DishID]
		switch {
		case !ok:
			errs[d.DishID.String()] = "este platillo no está afectado por la edición"
		case decided[d.DishID]:
			errs[d.DishID.String()] = "decisión duplicada"
		case d.Authorize && row.Blocked != "":
			errs[d.DishID.String()] = "no se puede autorizar: " + row.Blocked
		}
		decided[d.DishID] = true
	}
	for id := range byDish {
		if !decided[id] {
			errs[id.String()] = "falta la decisión de este platillo"
		}
	}
	if len(errs) > 0 {
		return RecalcResult{}, errs
	}
	active, err := s.catalog.ActiveEdition(ctx)
	if err != nil {
		return RecalcResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RecalcResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	batch, err := q.InsertRecalcBatch(ctx, db.InsertRecalcBatchParams{FromEditionID: active.ID, ToEditionID: toEdition, DecidedBy: a.ID})
	if err != nil {
		return RecalcResult{}, err
	}
	res := RecalcResult{BatchID: batch.ID}
	for _, d := range decisions {
		row := byDish[d.DishID]
		if !d.Authorize {
			if err := q.InsertRecalcDecision(ctx, db.InsertRecalcDecisionParams{BatchID: batch.ID, DishID: d.DishID, FromVersion: row.FromVersion, Decision: "rejected"}); err != nil {
				return RecalcResult{}, err
			}
			res.Rejected++
			continue
		}
		if _, err := tx.Exec(ctx, `SELECT 1 FROM dishes WHERE id = $1 FOR UPDATE`, d.DishID); err != nil {
			return RecalcResult{}, err
		}
		all, err := q.ListDishVersions(ctx, d.DishID)
		if err != nil {
			return RecalcResult{}, err
		}
		next := all[0].VersionNumber + 1
		v := row.version
		in := Input{
			Description: v.Description, RecipeMode: v.RecipeMode, InstructionsText: v.InstructionsText, Steps: v.Steps, Servings: v.Servings, PrepTimeMinutes: int(v.PrepTimeMinutes),
			Recommendations: v.Recommendations, ChangeReason: "Recalculado con " + ed.Name,
		}
		if v.ImageFileID.Valid {
			img := v.ImageFileID.UUID
			in.ImageFileID = &img
		}
		nv, err := s.writeVersion(ctx, q, a, d.DishID, next, in, computed{ingredients: row.rebuilt, result: row.result}, toEdition)
		if err != nil {
			return RecalcResult{}, err
		}
		subs, err := q.ListSubstitutions(ctx, v.VersionID)
		if err != nil {
			return RecalcResult{}, err
		}
		for _, sub := range subs {
			if _, err := q.InsertSubstitution(ctx, db.InsertSubstitutionParams{DishVersionID: nv.ID, SubstituteDishID: sub.SubstituteDishID, SubstituteVersion: sub.SubstituteVersion,
				Label: sub.Label, Note: sub.Note, Rule: sub.Rule, Diff: sub.Diff, ApprovedBy: sub.ApprovedBy}); err != nil {
				return RecalcResult{}, err
			}
		}
		dish, err := q.GetDish(ctx, d.DishID)
		if err != nil {
			return RecalcResult{}, err
		}
		if err := q.UpdateDishMeta(ctx, db.UpdateDishMetaParams{ID: d.DishID, Name: dish.Name, Category: dish.Category, Tags: dish.Tags, CurrentVersion: next}); err != nil {
			return RecalcResult{}, err
		}
		if err := q.InsertRecalcDecision(ctx, db.InsertRecalcDecisionParams{BatchID: batch.ID, DishID: d.DishID, FromVersion: row.FromVersion, ToVersion: pgtype.Int4{Int32: next, Valid: true}, Decision: "authorized"}); err != nil {
			return RecalcResult{}, err
		}
		res.Authorized++
	}
	if err := tx.Commit(ctx); err != nil {
		return RecalcResult{}, err
	}
	s.audit.Record(ctx, auditEvent(a, "smae.recalc", toEdition, map[string]any{"authorized": res.Authorized, "rejected": res.Rejected}))
	return res, nil
}

// ActivateEdition hace vigente una edición en borrador. Exige haber decidido el recálculo de los platillos
// afectados; la edición anterior queda archivada para reproducir planes históricos.
func (s *Service) ActivateEdition(ctx context.Context, a Actor, id uuid.UUID) (db.SmaeEdition, error) {
	ed, err := s.catalog.Edition(ctx, id)
	if err != nil {
		if errors.Is(err, smae.ErrNotFound) {
			return db.SmaeEdition{}, ErrNotFound
		}
		return db.SmaeEdition{}, err
	}
	if ed.Status != "draft" {
		return db.SmaeEdition{}, ErrEditionState
	}
	if cur, err := s.catalog.ActiveEdition(ctx); err == nil && cur.ID != id {
		if _, err := s.q.GetRecalcBatchForEdition(ctx, id); errors.Is(err, pgx.ErrNoRows) {
			rows, ierr := s.Impact(ctx, id)
			if ierr != nil {
				return db.SmaeEdition{}, ierr
			}
			if len(rows) > 0 {
				return db.SmaeEdition{}, ErrRecalcRequired
			}
		} else if err != nil {
			return db.SmaeEdition{}, err
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.SmaeEdition{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if cur, err := q.GetActiveEdition(ctx); err == nil {
		if err := q.SetEditionStatus(ctx, db.SetEditionStatusParams{ID: cur.ID, Status: "archived"}); err != nil {
			return db.SmaeEdition{}, err
		}
	}
	if err := q.SetEditionStatus(ctx, db.SetEditionStatusParams{ID: id, Status: "active"}); err != nil {
		return db.SmaeEdition{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.SmaeEdition{}, err
	}
	s.audit.Record(ctx, auditEvent(a, "smae.activate", id, nil))
	return s.catalog.Edition(ctx, id)
}
