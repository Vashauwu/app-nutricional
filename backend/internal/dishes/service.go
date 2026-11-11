// Package dishes implementa la biblioteca de platillos con versiones inmutables y cálculo reproducible
// (MVP_SPEC §6, §7.4, §8). Todo valor nutricional lo calcula el servidor con nutrition_engine:
// el cliente envía ingredientes y cantidades, nunca resultados.
package dishes

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
	"github.com/nutri/app-nutricional/backend/internal/smae"
)

var (
	ErrNotFound       = errors.New("no encontrado")
	ErrRecalcRequired = errors.New("hay platillos afectados por esta edición: registra primero las decisiones de recálculo")
)

type ValidationError map[string]string

func (v ValidationError) Error() string { return "datos inválidos" }

type Actor struct {
	ID        uuid.UUID
	RequestID string
}

// Catalog es lo que dishes necesita del catálogo (lo implementa smae.Service).
type Catalog interface {
	ActiveEdition(ctx context.Context) (db.SmaeEdition, error)
	Resolve(ctx context.Context, kind string, id uuid.UUID) (smae.Food, error)
	ResolveByEditionCode(ctx context.Context, editionID uuid.UUID, code string) (smae.Food, error)
	Edition(ctx context.Context, id uuid.UUID) (db.SmaeEdition, error)
}

type Service struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	catalog  Catalog
	audit    audit.Recorder
	log      *slog.Logger
	clinical ClinicalReader
}

func NewService(pool *pgxpool.Pool, catalog Catalog, log *slog.Logger) *Service {
	q := db.New(pool)
	return &Service{pool: pool, q: q, catalog: catalog, audit: audit.Recorder{Q: q, Log: log}, log: log}
}

func (s *Service) rec(ctx context.Context, a Actor, action string, id uuid.UUID, meta map[string]any) {
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: action, ResourceType: "dish", ResourceID: id, RequestID: a.RequestID, Metadata: meta})
}

// ---------- Entrada ----------
type IngredientInput struct {
	FoodKind string
	FoodID   uuid.UUID
	Quantity decimal.Decimal
	Unit     string
}

type Input struct {
	Name, Category, Description, RecipeMode, InstructionsText, Recommendations, ChangeReason string
	Tags, Steps                                                                              []string
	Servings                                                                                 decimal.Decimal
	PrepTimeMinutes                                                                          int
	ImageFileID                                                                              *uuid.UUID
	Ingredients                                                                              []IngredientInput
}

func (in Input) validate(newVersion bool) ValidationError {
	errs := ValidationError{}
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 120 {
		errs["name"] = "el nombre es obligatorio (máx. 120 caracteres)"
	}
	if strings.TrimSpace(in.Category) == "" {
		errs["category"] = "la categoría es obligatoria"
	}
	if in.RecipeMode != "structured" && in.RecipeMode != "free" {
		errs["recipe_mode"] = "la modalidad debe ser structured o free"
	}
	if in.Servings.Sign() <= 0 {
		errs["servings"] = "las porciones deben ser mayores a cero"
	}
	if in.PrepTimeMinutes < 0 || in.PrepTimeMinutes > 24*60 {
		errs["prep_time_minutes"] = "tiempo de preparación fuera de rango"
	}
	if in.RecipeMode == "structured" && len(in.Ingredients) == 0 {
		errs["ingredients"] = "agrega al menos un ingrediente para calcular el valor nutricional"
	}
	if len(in.Ingredients) > 60 {
		errs["ingredients"] = "máximo 60 ingredientes"
	}
	for _, ing := range in.Ingredients {
		if ing.Quantity.Sign() <= 0 || ing.Unit == "" {
			errs["ingredients"] = "cada ingrediente requiere cantidad mayor a cero y unidad"
		}
	}
	if newVersion && strings.TrimSpace(in.ChangeReason) == "" {
		errs["change_reason"] = "indica qué cambió y por qué"
	}
	return errs
}

// ---------- Cálculo ----------
type computed struct {
	ingredients []db.InsertIngredientParams
	result      calculator.DishResult
}

// compute resuelve cada alimento y calcula con el motor. Rechaza alimentos de otra edición o inactivos.
func (s *Service) compute(ctx context.Context, in Input, edition uuid.UUID) (computed, error) {
	var out computed
	results := make([]calculator.IngredientResult, 0, len(in.Ingredients))
	for i, ing := range in.Ingredients {
		key := fmt.Sprintf("ingredients[%d]", i)
		food, err := s.catalog.Resolve(ctx, ing.FoodKind, ing.FoodID)
		if err != nil {
			if errors.Is(err, smae.ErrNotFound) {
				return out, ValidationError{key: "el alimento no existe"}
			}
			return out, err
		}
		if food.Kind == "smae" && (food.EditionID == nil || *food.EditionID != edition) {
			return out, ValidationError{key: fmt.Sprintf("«%s» pertenece a otra edición del catálogo; elígelo de la edición activa", food.Name)}
		}
		if food.Status != "active" {
			return out, ValidationError{key: fmt.Sprintf("«%s» está inactivo", food.Name)}
		}
		r, err := calculator.CalcIngredient(food.ToCalc(), ing.Quantity, ing.Unit)
		if err != nil {
			return out, ValidationError{key: err.Error()}
		}
		results = append(results, r)
		p := db.InsertIngredientParams{
			Position: int32(i), FoodKind: ing.FoodKind, FoodID: ing.FoodID, NameSnapshot: food.Name, Quantity: ing.Quantity, Unit: ing.Unit, Grams: r.Grams,
			EnergyKcal: r.Nutrients.EnergyKcal, ProteinG: r.Nutrients.ProteinG, CarbohydratesG: r.Nutrients.CarbohydratesG, LipidsG: r.Nutrients.LipidsG, FiberG: r.Nutrients.FiberG,
			Official: r.Official,
		}
		if r.HasEquivalent {
			p.EquivalentCode = pgtype.Text{String: r.EquivalentCode, Valid: true}
			p.EquivalentValue = decimal.NullDecimal{Decimal: r.EquivalentValue, Valid: true}
		}
		out.ingredients = append(out.ingredients, p)
	}
	res, err := calculator.CalcDish(results, in.Servings)
	if err != nil {
		return out, ValidationError{"servings": err.Error()}
	}
	out.result = res
	return out, nil
}

func snapshotParams(versionID uuid.UUID, r calculator.DishResult) (db.InsertSnapshotParams, error) {
	eq := map[string]string{}
	for k, v := range r.Equivalents {
		eq[k] = v.String()
	}
	b, err := json.Marshal(eq)
	if err != nil {
		return db.InsertSnapshotParams{}, err
	}
	return db.InsertSnapshotParams{
		DishVersionID: versionID, TotalsEnergy: r.Totals.EnergyKcal, TotalsProtein: r.Totals.ProteinG, TotalsCarbs: r.Totals.CarbohydratesG, TotalsLipids: r.Totals.LipidsG, TotalsFiber: r.Totals.FiberG,
		ServingEnergy: r.PerServing.EnergyKcal, ServingProtein: r.PerServing.ProteinG, ServingCarbs: r.PerServing.CarbohydratesG, ServingLipids: r.PerServing.LipidsG, ServingFiber: r.PerServing.FiberG,
		Equivalents: b, HasCustomFoods: r.HasCustom, EngineVersion: calculator.EngineVersion,
	}, nil
}

func cleanList(l []string) []string {
	out := make([]string, 0, len(l))
	for _, s := range l {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func imageParam(id *uuid.UUID) uuid.NullUUID {
	if id == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *id, Valid: true}
}

// writeVersion inserta versión + ingredientes + snapshot dentro de la transacción q.
func (s *Service) writeVersion(ctx context.Context, q *db.Queries, a Actor, dishID uuid.UUID, number int32, in Input, c computed, edition uuid.UUID) (db.DishVersion, error) {
	v, err := q.InsertDishVersion(ctx, db.InsertDishVersionParams{
		DishID: dishID, VersionNumber: number, Description: in.Description, RecipeMode: in.RecipeMode, InstructionsText: in.InstructionsText, Steps: cleanList(in.Steps),
		Servings: in.Servings, PrepTimeMinutes: int32(in.PrepTimeMinutes), Recommendations: in.Recommendations, ImageFileID: imageParam(in.ImageFileID),
		SmaeEditionID: edition, CreatedBy: a.ID, ChangeReason: strings.TrimSpace(in.ChangeReason),
	})
	if err != nil {
		return db.DishVersion{}, err
	}
	for _, ing := range c.ingredients {
		ing.DishVersionID = v.ID
		if err := q.InsertIngredient(ctx, ing); err != nil {
			return db.DishVersion{}, err
		}
	}
	sp, err := snapshotParams(v.ID, c.result)
	if err != nil {
		return db.DishVersion{}, err
	}
	return v, q.InsertSnapshot(ctx, sp)
}

// Create crea el platillo y su versión 1.
func (s *Service) Create(ctx context.Context, a Actor, in Input) (DishView, error) {
	if e := in.validate(false); len(e) > 0 {
		return DishView{}, e
	}
	ed, err := s.catalog.ActiveEdition(ctx)
	if err != nil {
		return DishView{}, err
	}
	c, err := s.compute(ctx, in, ed.ID)
	if err != nil {
		return DishView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DishView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	d, err := q.InsertDish(ctx, db.InsertDishParams{OwnerUserID: a.ID, Name: strings.TrimSpace(in.Name), Category: strings.TrimSpace(in.Category), Tags: cleanList(in.Tags)})
	if err != nil {
		return DishView{}, err
	}
	in.ChangeReason = "Versión inicial"
	if _, err := s.writeVersion(ctx, q, a, d.ID, 1, in, c, ed.ID); err != nil {
		return DishView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DishView{}, err
	}
	s.rec(ctx, a, "dish.create", d.ID, nil)
	return s.Get(ctx, d.ID, 0)
}

// NewVersion guarda los cambios como una versión NUEVA; las anteriores no se tocan (§7.4).
func (s *Service) NewVersion(ctx context.Context, a Actor, id uuid.UUID, in Input) (DishView, error) {
	if e := in.validate(true); len(e) > 0 {
		return DishView{}, e
	}
	d, err := s.q.GetDish(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return DishView{}, ErrNotFound
	}
	if err != nil {
		return DishView{}, err
	}
	ed, err := s.catalog.ActiveEdition(ctx)
	if err != nil {
		return DishView{}, err
	}
	c, err := s.compute(ctx, in, ed.ID)
	if err != nil {
		return DishView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DishView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	// Se bloquea la fila del platillo para que dos guardados simultáneos no repitan el número de versión.
	if _, err := tx.Exec(ctx, `SELECT 1 FROM dishes WHERE id = $1 FOR UPDATE`, id); err != nil {
		return DishView{}, err
	}
	vs, err := q.ListDishVersions(ctx, id)
	if err != nil {
		return DishView{}, err
	}
	next := int32(1)
	if len(vs) > 0 {
		next = vs[0].VersionNumber + 1
	}
	prev, _ := q.GetDishVersion(ctx, db.GetDishVersionParams{DishID: id, VersionNumber: d.CurrentVersion})
	if in.ImageFileID == nil && prev.ImageFileID.Valid {
		img := prev.ImageFileID.UUID
		in.ImageFileID = &img // se conserva la foto anterior si no se envía una nueva
	}
	nv, err := s.writeVersion(ctx, q, a, id, next, in, c, ed.ID)
	if err != nil {
		return DishView{}, err
	}
	// Las sustituciones autorizadas se heredan a la versión nueva.
	subs, err := q.ListSubstitutions(ctx, prev.ID)
	if err != nil {
		return DishView{}, err
	}
	for _, sub := range subs {
		if _, err := q.InsertSubstitution(ctx, db.InsertSubstitutionParams{DishVersionID: nv.ID, SubstituteDishID: sub.SubstituteDishID, SubstituteVersion: sub.SubstituteVersion,
			Label: sub.Label, Note: sub.Note, Rule: sub.Rule, Diff: sub.Diff, ApprovedBy: sub.ApprovedBy}); err != nil {
			return DishView{}, err
		}
	}
	if err := q.UpdateDishMeta(ctx, db.UpdateDishMetaParams{ID: id, Name: strings.TrimSpace(in.Name), Category: strings.TrimSpace(in.Category), Tags: cleanList(in.Tags), CurrentVersion: next}); err != nil {
		return DishView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DishView{}, err
	}
	s.rec(ctx, a, "dish.version", id, map[string]any{"version": next})
	return s.Get(ctx, id, 0)
}

// Duplicate copia la versión vigente tal cual (con sus datos de cálculo) como un platillo nuevo.
func (s *Service) Duplicate(ctx context.Context, a Actor, id uuid.UUID) (DishView, error) {
	d, err := s.q.GetDish(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return DishView{}, ErrNotFound
	}
	if err != nil {
		return DishView{}, err
	}
	cur, err := s.q.GetDishVersion(ctx, db.GetDishVersionParams{DishID: id, VersionNumber: d.CurrentVersion})
	if err != nil {
		return DishView{}, err
	}
	ings, err := s.q.ListIngredients(ctx, cur.ID)
	if err != nil {
		return DishView{}, err
	}
	snap, err := s.q.GetSnapshot(ctx, cur.ID)
	if err != nil {
		return DishView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DishView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	nd, err := q.InsertDish(ctx, db.InsertDishParams{OwnerUserID: a.ID, Name: "Copia de " + d.Name, Category: d.Category, Tags: d.Tags})
	if err != nil {
		return DishView{}, err
	}
	v, err := q.InsertDishVersion(ctx, db.InsertDishVersionParams{
		DishID: nd.ID, VersionNumber: 1, Description: cur.Description, RecipeMode: cur.RecipeMode, InstructionsText: cur.InstructionsText, Steps: cur.Steps, Servings: cur.Servings,
		PrepTimeMinutes: cur.PrepTimeMinutes, Recommendations: cur.Recommendations, ImageFileID: cur.ImageFileID, SmaeEditionID: cur.SmaeEditionID, CreatedBy: a.ID,
		ChangeReason: fmt.Sprintf("Duplicado de «%s»", d.Name),
	})
	if err != nil {
		return DishView{}, err
	}
	for _, i := range ings {
		if err := q.InsertIngredient(ctx, db.InsertIngredientParams{
			DishVersionID: v.ID, Position: i.Position, FoodKind: i.FoodKind, FoodID: i.FoodID, NameSnapshot: i.NameSnapshot, Quantity: i.Quantity, Unit: i.Unit, Grams: i.Grams,
			EnergyKcal: i.EnergyKcal, ProteinG: i.ProteinG, CarbohydratesG: i.CarbohydratesG, LipidsG: i.LipidsG, FiberG: i.FiberG, EquivalentCode: i.EquivalentCode,
			EquivalentValue: i.EquivalentValue, Official: i.Official,
		}); err != nil {
			return DishView{}, err
		}
	}
	if err := q.InsertSnapshot(ctx, db.InsertSnapshotParams{
		DishVersionID: v.ID, TotalsEnergy: snap.TotalsEnergy, TotalsProtein: snap.TotalsProtein, TotalsCarbs: snap.TotalsCarbs, TotalsLipids: snap.TotalsLipids, TotalsFiber: snap.TotalsFiber,
		ServingEnergy: snap.ServingEnergy, ServingProtein: snap.ServingProtein, ServingCarbs: snap.ServingCarbs, ServingLipids: snap.ServingLipids, ServingFiber: snap.ServingFiber,
		Equivalents: snap.Equivalents, HasCustomFoods: snap.HasCustomFoods, EngineVersion: snap.EngineVersion,
	}); err != nil {
		return DishView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DishView{}, err
	}
	s.rec(ctx, a, "dish.duplicate", nd.ID, map[string]any{"from": id})
	return s.Get(ctx, nd.ID, 0)
}

func (s *Service) SetActive(ctx context.Context, a Actor, id uuid.UUID, active bool) error {
	if _, err := s.q.GetDish(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	st := "inactive"
	if active {
		st = "active"
	}
	if err := s.q.SetDishStatus(ctx, db.SetDishStatusParams{ID: id, Status: st}); err != nil {
		return err
	}
	s.rec(ctx, a, "dish.status", id, map[string]any{"status": st})
	return nil
}

// ---------- Salida ----------
type IngredientDTO struct {
	Position       int32                `json:"position"`
	FoodKind       string               `json:"food_kind"`
	FoodID         uuid.UUID            `json:"food_id"`
	Name           string               `json:"name"`
	Quantity       decimal.Decimal      `json:"quantity"`
	Unit           string               `json:"unit"`
	Grams          decimal.Decimal      `json:"grams"`
	Nutrients      calculator.Nutrients `json:"nutrients"`
	EquivalentCode *string              `json:"equivalent_code"`
	EquivalentVal  *decimal.Decimal     `json:"equivalent_value"`
	Official       bool                 `json:"official"`
}

type NutritionDTO struct {
	Totals         calculator.Nutrients       `json:"totals"`
	PerServing     calculator.Nutrients       `json:"per_serving"`
	Equivalents    map[string]decimal.Decimal `json:"equivalents"`
	HasCustomFoods bool                       `json:"has_custom_foods"`
	EngineVersion  string                     `json:"engine_version"`
	CalculatedAt   time.Time                  `json:"calculated_at"`
}

type SubstitutionDTO struct {
	ID          uuid.UUID       `json:"id"`
	DishID      uuid.UUID       `json:"dish_id"`
	DishVersion int32           `json:"dish_version"`
	Label       string          `json:"label"`
	Note        string          `json:"note"`
	Rule        string          `json:"rule"`
	Diff        json.RawMessage `json:"diff"`
	ApprovedAt  time.Time       `json:"approved_at"`
}

type VersionDTO struct {
	VersionNumber    int32             `json:"version_number"`
	Description      string            `json:"description"`
	RecipeMode       string            `json:"recipe_mode"`
	InstructionsText string            `json:"instructions_text"`
	Steps            []string          `json:"steps"`
	Servings         decimal.Decimal   `json:"servings"`
	PrepTimeMinutes  int32             `json:"prep_time_minutes"`
	Recommendations  string            `json:"recommendations"`
	ImageFileID      *uuid.UUID        `json:"image_file_id"`
	SmaeEditionID    uuid.UUID         `json:"smae_edition_id"`
	ChangeReason     string            `json:"change_reason"`
	CreatedAt        time.Time         `json:"created_at"`
	Ingredients      []IngredientDTO   `json:"ingredients"`
	Nutrition        NutritionDTO      `json:"nutrition"`
	Substitutions    []SubstitutionDTO `json:"substitutions"`
}

type VersionSummary struct {
	VersionNumber int32           `json:"version_number"`
	CreatedAt     time.Time       `json:"created_at"`
	ChangeReason  string          `json:"change_reason"`
	ServingEnergy decimal.Decimal `json:"serving_energy_kcal"`
}

type DishView struct {
	ID             uuid.UUID        `json:"id"`
	Name           string           `json:"name"`
	Category       string           `json:"category"`
	Tags           []string         `json:"tags"`
	Status         string           `json:"status"`
	CurrentVersion int32            `json:"current_version"`
	CreatedAt      time.Time        `json:"created_at"`
	Version        VersionDTO       `json:"version"`
	Versions       []VersionSummary `json:"versions"`
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

func nutritionDTO(sn db.DishNutritionSnapshot) NutritionDTO {
	return NutritionDTO{
		Totals:      calculator.Nutrients{EnergyKcal: sn.TotalsEnergy, ProteinG: sn.TotalsProtein, CarbohydratesG: sn.TotalsCarbs, LipidsG: sn.TotalsLipids, FiberG: sn.TotalsFiber},
		PerServing:  calculator.Nutrients{EnergyKcal: sn.ServingEnergy, ProteinG: sn.ServingProtein, CarbohydratesG: sn.ServingCarbs, LipidsG: sn.ServingLipids, FiberG: sn.ServingFiber},
		Equivalents: parseEq(sn.Equivalents), HasCustomFoods: sn.HasCustomFoods, EngineVersion: sn.EngineVersion, CalculatedAt: sn.CalculatedAt.Time,
	}
}

// Version devuelve una versión concreta (0 = vigente) con todo lo necesario para mostrarla.
func (s *Service) Get(ctx context.Context, id uuid.UUID, version int32) (DishView, error) {
	d, err := s.q.GetDish(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return DishView{}, ErrNotFound
	}
	if err != nil {
		return DishView{}, err
	}
	if version == 0 {
		version = d.CurrentVersion
	}
	v, err := s.q.GetDishVersion(ctx, db.GetDishVersionParams{DishID: id, VersionNumber: version})
	if errors.Is(err, pgx.ErrNoRows) {
		return DishView{}, ErrNotFound
	}
	if err != nil {
		return DishView{}, err
	}
	vd, err := s.versionDTO(ctx, v)
	if err != nil {
		return DishView{}, err
	}
	all, err := s.q.ListDishVersions(ctx, id)
	if err != nil {
		return DishView{}, err
	}
	sums := make([]VersionSummary, 0, len(all))
	for _, x := range all {
		sums = append(sums, VersionSummary{VersionNumber: x.VersionNumber, CreatedAt: x.CreatedAt.Time, ChangeReason: x.ChangeReason, ServingEnergy: x.ServingEnergy})
	}
	return DishView{ID: d.ID, Name: d.Name, Category: d.Category, Tags: nilStr(d.Tags), Status: d.Status, CurrentVersion: d.CurrentVersion, CreatedAt: d.CreatedAt.Time, Version: vd, Versions: sums}, nil
}

func nilStr(t []string) []string {
	if t == nil {
		return []string{}
	}
	return t
}

func (s *Service) versionDTO(ctx context.Context, v db.DishVersion) (VersionDTO, error) {
	ings, err := s.q.ListIngredients(ctx, v.ID)
	if err != nil {
		return VersionDTO{}, err
	}
	sn, err := s.q.GetSnapshot(ctx, v.ID)
	if err != nil {
		return VersionDTO{}, err
	}
	subs, err := s.q.ListSubstitutions(ctx, v.ID)
	if err != nil {
		return VersionDTO{}, err
	}
	out := VersionDTO{
		VersionNumber: v.VersionNumber, Description: v.Description, RecipeMode: v.RecipeMode, InstructionsText: v.InstructionsText, Steps: nilStr(v.Steps), Servings: v.Servings,
		PrepTimeMinutes: v.PrepTimeMinutes, Recommendations: v.Recommendations, SmaeEditionID: v.SmaeEditionID, ChangeReason: v.ChangeReason, CreatedAt: v.CreatedAt.Time,
		Ingredients: []IngredientDTO{}, Nutrition: nutritionDTO(sn), Substitutions: []SubstitutionDTO{},
	}
	if v.ImageFileID.Valid {
		u := v.ImageFileID.UUID
		out.ImageFileID = &u
	}
	for _, i := range ings {
		dto := IngredientDTO{
			Position: i.Position, FoodKind: i.FoodKind, FoodID: i.FoodID, Name: i.NameSnapshot, Quantity: i.Quantity, Unit: i.Unit, Grams: i.Grams, Official: i.Official,
			Nutrients: calculator.Nutrients{EnergyKcal: i.EnergyKcal, ProteinG: i.ProteinG, CarbohydratesG: i.CarbohydratesG, LipidsG: i.LipidsG, FiberG: i.FiberG},
		}
		if i.EquivalentCode.Valid {
			c := i.EquivalentCode.String
			dto.EquivalentCode = &c
			dto.EquivalentVal = &i.EquivalentValue.Decimal
		}
		out.Ingredients = append(out.Ingredients, dto)
	}
	for _, x := range subs {
		out.Substitutions = append(out.Substitutions, SubstitutionDTO{ID: x.ID, DishID: x.SubstituteDishID, DishVersion: x.SubstituteVersion, Label: x.Label, Note: x.Note, Rule: x.Rule, Diff: x.Diff, ApprovedAt: x.ApprovedAt.Time})
	}
	return out, nil
}

// ---------- Listado ----------
type ListQuery struct {
	Search, Category, SubgroupCode, Status string
	Limit, Offset                          int
}

type ListItem struct {
	ID             uuid.UUID                  `json:"id"`
	Name           string                     `json:"name"`
	Category       string                     `json:"category"`
	Tags           []string                   `json:"tags"`
	Status         string                     `json:"status"`
	CurrentVersion int32                      `json:"current_version"`
	Description    string                     `json:"description"`
	Servings       decimal.Decimal            `json:"servings"`
	PrepTime       int32                      `json:"prep_time_minutes"`
	PerServing     calculator.Nutrients       `json:"per_serving"`
	Equivalents    map[string]decimal.Decimal `json:"equivalents"`
	HasCustomFoods bool                       `json:"has_custom_foods"`
}

type ListResult struct {
	Items  []ListItem `json:"items"`
	Total  int64      `json:"total"`
	Limit  int        `json:"limit"`
	Offset int        `json:"offset"`
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(s))
}

func (s *Service) List(ctx context.Context, q ListQuery) (ListResult, error) {
	if q.Limit < 1 || q.Limit > 100 {
		q.Limit = 12
	}
	rows, err := s.q.ListDishes(ctx, db.ListDishesParams{Status: q.Status, Category: q.Category, SubgroupCode: q.SubgroupCode, Search: escapeLike(q.Search), PageLimit: int32(q.Limit), PageOffset: int32(q.Offset)})
	if err != nil {
		return ListResult{}, err
	}
	out := ListResult{Items: []ListItem{}, Limit: q.Limit, Offset: q.Offset}
	for _, r := range rows {
		out.Total = r.Total
		out.Items = append(out.Items, ListItem{
			ID: r.ID, Name: r.Name, Category: r.Category, Tags: nilStr(r.Tags), Status: r.Status, CurrentVersion: r.CurrentVersion, Description: r.Description, Servings: r.Servings, PrepTime: r.PrepTimeMinutes,
			PerServing:  calculator.Nutrients{EnergyKcal: r.ServingEnergy, ProteinG: r.ServingProtein, CarbohydratesG: r.ServingCarbs, LipidsG: r.ServingLipids, FiberG: r.ServingFiber},
			Equivalents: parseEq(r.Equivalents), HasCustomFoods: r.HasCustomFoods,
		})
	}
	return out, nil
}

func auditEvent(a Actor, action string, id uuid.UUID, meta map[string]any) audit.Event {
	return audit.Event{Actor: a.ID, Action: action, ResourceType: "smae_edition", ResourceID: id, RequestID: a.RequestID, Metadata: meta}
}

// rowServing reúne la nutrición por porción de una fila del listado.
func rowServing(r db.ListDishesRow) calculator.Nutrients {
	return calculator.Nutrients{EnergyKcal: r.ServingEnergy, ProteinG: r.ServingProtein, CarbohydratesG: r.ServingCarbs, LipidsG: r.ServingLipids, FiberG: r.ServingFiber}
}

// UsedInPlans cuenta los planes no archivados que usan el platillo (para avisar antes de desactivarlo).
func (s *Service) UsedInPlans(ctx context.Context, id uuid.UUID) (int64, error) {
	if _, err := s.q.GetDish(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return s.q.PlansUsingDish(ctx, id)
}
