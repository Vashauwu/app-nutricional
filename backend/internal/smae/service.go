// Package smae administra el catálogo SMAE versionado y los alimentos personalizados (MVP_SPEC §7, §30).
// No contiene lógica de platillos ni de cálculo: eso vive en dishes y nutrition_engine.
package smae

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	ErrNotFound      = errors.New("no encontrado")
	ErrNoActive      = errors.New("no hay una edición SMAE activa")
	ErrInvalidImport = errors.New("la importación contiene errores")
)

// ValidationError agrupa errores por campo o por fila.
type ValidationError map[string]string

func (v ValidationError) Error() string { return "datos inválidos" }

type Actor struct {
	ID        uuid.UUID
	RequestID string
}

type Service struct {
	pool  *pgxpool.Pool
	q     *db.Queries
	audit audit.Recorder
	log   *slog.Logger
}

func NewService(pool *pgxpool.Pool, log *slog.Logger) *Service {
	q := db.New(pool)
	return &Service{pool: pool, q: q, audit: audit.Recorder{Q: q, Log: log}, log: log}
}

func (s *Service) rec(ctx context.Context, a Actor, action, resType string, id uuid.UUID, meta map[string]any) {
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: action, ResourceType: resType, ResourceID: id, RequestID: a.RequestID, Metadata: meta})
}

// ---------- Vistas (JSON) ----------
type PortionDTO struct {
	Name            string          `json:"name"`
	Unit            string          `json:"unit"`
	Quantity        decimal.Decimal `json:"quantity"`
	GramsEquivalent decimal.Decimal `json:"grams_equivalent"`
}

type EquivalenceDTO struct {
	SubgroupCode    string          `json:"subgroup_code"`
	ReferenceGrams  decimal.Decimal `json:"reference_grams"`
	EquivalentValue decimal.Decimal `json:"equivalent_value"`
	AssignedAt      *time.Time      `json:"assigned_at,omitempty"`
	Criterion       string          `json:"criterion,omitempty"`
}

// Food es la vista unificada de un alimento SMAE o personalizado.
type Food struct {
	Kind            string           `json:"kind"` // smae | custom
	ID              uuid.UUID        `json:"id"`
	EditionID       *uuid.UUID       `json:"edition_id,omitempty"`
	Code            string           `json:"code,omitempty"`
	Name            string           `json:"name"`
	Brand           string           `json:"brand,omitempty"`
	Description     string           `json:"description,omitempty"`
	Official        bool             `json:"official"`
	GroupID         *uuid.UUID       `json:"group_id,omitempty"`
	Tags            []string         `json:"tags"`
	Portions        []PortionDTO     `json:"portions"`
	BasisQuantity   decimal.Decimal  `json:"basis_quantity"`
	BasisUnit       string           `json:"basis_unit"`
	EnergyKcal      decimal.Decimal  `json:"energy_kcal"`
	ProteinG        decimal.Decimal  `json:"protein_g"`
	CarbohydratesG  decimal.Decimal  `json:"carbohydrates_g"`
	LipidsG         decimal.Decimal  `json:"lipids_g"`
	FiberG          decimal.Decimal  `json:"fiber_g"`
	DensityGPerMl   *decimal.Decimal `json:"density_g_per_ml,omitempty"`
	Equivalence     *EquivalenceDTO  `json:"equivalence,omitempty"`
	SourceType      string           `json:"source_type,omitempty"`
	SourceReference string           `json:"source_reference,omitempty"`
	ValidatedAt     *time.Time       `json:"validated_at,omitempty"`
	Status          string           `json:"status"`
}

// ToCalc adapta la vista al motor nutricional.
func (f Food) ToCalc() calculator.Food {
	cf := calculator.Food{
		Name: f.Name, Official: f.Official, BasisQuantity: f.BasisQuantity, BasisUnit: f.BasisUnit, DensityGPerMl: f.DensityGPerMl,
		Base: calculator.Nutrients{EnergyKcal: f.EnergyKcal, ProteinG: f.ProteinG, CarbohydratesG: f.CarbohydratesG, LipidsG: f.LipidsG, FiberG: f.FiberG},
	}
	for _, p := range f.Portions {
		cf.Portions = append(cf.Portions, calculator.Portion{Unit: p.Unit, Name: p.Name, Quantity: p.Quantity, GramsEquivalent: p.GramsEquivalent})
	}
	if f.Equivalence != nil {
		cf.Equivalence = &calculator.Equivalence{SubgroupCode: f.Equivalence.SubgroupCode, ReferenceGrams: f.Equivalence.ReferenceGrams, EquivalentValue: f.Equivalence.EquivalentValue}
	}
	return cf
}

func nilTags(t []string) []string {
	if t == nil {
		return []string{}
	}
	return t
}

func nullDec(d decimal.NullDecimal) *decimal.Decimal {
	if !d.Valid {
		return nil
	}
	v := d.Decimal
	return &v
}

func smaeFood(f db.SmaeFood, subgroupCode string, group uuid.UUID, portions []db.SmaePortion) Food {
	out := Food{
		Kind: "smae", ID: f.ID, EditionID: &f.EditionID, Code: f.Code, Name: f.Name, Official: true, GroupID: &group, Tags: nilTags(f.Tags),
		Portions: []PortionDTO{}, BasisQuantity: f.BasisQuantity, BasisUnit: f.BasisUnit, EnergyKcal: f.EnergyKcal, ProteinG: f.ProteinG,
		CarbohydratesG: f.CarbohydratesG, LipidsG: f.LipidsG, FiberG: f.FiberG, DensityGPerMl: nullDec(f.DensityGPerMl),
		Equivalence:     &EquivalenceDTO{SubgroupCode: subgroupCode, ReferenceGrams: f.EquivReferenceGrams, EquivalentValue: f.EquivValue},
		SourceReference: f.SourceReference, Status: f.Status,
	}
	for _, p := range portions {
		out.Portions = append(out.Portions, PortionDTO{Name: p.Name, Unit: p.Unit, Quantity: p.Quantity, GramsEquivalent: p.GramsEquivalent})
	}
	return out
}

func customFood(c db.CustomFood, portions []db.CustomFoodPortion) Food {
	out := Food{
		Kind: "custom", ID: c.ID, Name: c.Name, Description: c.Description, Official: false, Tags: nilTags(c.Tags), Portions: []PortionDTO{},
		BasisQuantity: c.BasisQuantity, BasisUnit: c.BasisUnit, EnergyKcal: c.EnergyKcal, ProteinG: c.ProteinG, CarbohydratesG: c.CarbohydratesG,
		LipidsG: c.LipidsG, FiberG: c.FiberG, DensityGPerMl: nullDec(c.DensityGPerMl), SourceType: c.SourceType, SourceReference: c.SourceReference, Status: c.Status,
	}
	if c.Brand.Valid {
		out.Brand = c.Brand.String
	}
	if c.ValidatedAt.Valid {
		t := c.ValidatedAt.Time
		out.ValidatedAt = &t
	}
	if c.EqSubgroupCode.Valid {
		eq := &EquivalenceDTO{SubgroupCode: c.EqSubgroupCode.String, ReferenceGrams: c.EqReferenceGrams.Decimal, EquivalentValue: c.EqValue.Decimal, Criterion: c.EqCriterion.String}
		if c.EqAssignedAt.Valid {
			t := c.EqAssignedAt.Time
			eq.AssignedAt = &t
		}
		out.Equivalence = eq
	}
	for _, p := range portions {
		out.Portions = append(out.Portions, PortionDTO{Name: p.Name, Unit: p.Unit, Quantity: p.Quantity, GramsEquivalent: p.GramsEquivalent})
	}
	return out
}

// ---------- Consulta ----------
func (s *Service) ActiveEdition(ctx context.Context) (db.SmaeEdition, error) {
	e, err := s.q.GetActiveEdition(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.SmaeEdition{}, ErrNoActive
	}
	return e, err
}

type Taxonomy struct {
	Edition   db.SmaeEdition        `json:"edition"`
	Groups    []db.SmaeFoodGroup    `json:"groups"`
	Subgroups []db.SmaeFoodSubgroup `json:"subgroups"`
}

func (s *Service) Taxonomy(ctx context.Context, editionID uuid.UUID) (Taxonomy, error) {
	e, err := s.q.GetEdition(ctx, editionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Taxonomy{}, ErrNotFound
	}
	if err != nil {
		return Taxonomy{}, err
	}
	g, err := s.q.ListGroups(ctx, editionID)
	if err != nil {
		return Taxonomy{}, err
	}
	sg, err := s.q.ListSubgroups(ctx, editionID)
	if err != nil {
		return Taxonomy{}, err
	}
	if g == nil {
		g = []db.SmaeFoodGroup{}
	}
	if sg == nil {
		sg = []db.SmaeFoodSubgroup{}
	}
	return Taxonomy{Edition: e, Groups: g, Subgroups: sg}, nil
}

func (s *Service) Editions(ctx context.Context) ([]db.SmaeEdition, error) {
	l, err := s.q.ListEditions(ctx)
	if l == nil {
		l = []db.SmaeEdition{}
	}
	return l, err
}

func (s *Service) Edition(ctx context.Context, id uuid.UUID) (db.SmaeEdition, error) {
	e, err := s.q.GetEdition(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.SmaeEdition{}, ErrNotFound
	}
	return e, err
}

func (s *Service) portionsOf(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][]db.SmaePortion, error) {
	rows, err := s.q.ListPortionsForFoods(ctx, ids)
	if err != nil {
		return nil, err
	}
	m := map[uuid.UUID][]db.SmaePortion{}
	for _, p := range rows {
		m[p.FoodID] = append(m[p.FoodID], p)
	}
	return m, nil
}

// Resolve devuelve un alimento SMAE (de cualquier edición, para reproducir cálculos históricos) o personalizado.
func (s *Service) Resolve(ctx context.Context, kind string, id uuid.UUID) (Food, error) {
	switch kind {
	case "smae":
		r, err := s.q.GetFood(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return Food{}, ErrNotFound
		}
		if err != nil {
			return Food{}, err
		}
		ps, err := s.portionsOf(ctx, []uuid.UUID{id})
		if err != nil {
			return Food{}, err
		}
		return smaeFood(r.SmaeFood, r.SubgroupCode, r.GroupID, ps[id]), nil
	case "custom":
		c, err := s.q.GetCustomFood(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return Food{}, ErrNotFound
		}
		if err != nil {
			return Food{}, err
		}
		ps, err := s.q.ListCustomPortionsFor(ctx, []uuid.UUID{id})
		return customFood(c, ps), err
	}
	return Food{}, ValidationError{"kind": "el tipo de alimento debe ser smae o custom"}
}

// ResolveByEditionCode busca el alimento equivalente (mismo código) en otra edición.
func (s *Service) ResolveByEditionCode(ctx context.Context, editionID uuid.UUID, code string) (Food, error) {
	r, err := s.q.GetFoodByEditionCode(ctx, db.GetFoodByEditionCodeParams{EditionID: editionID, Code: code})
	if errors.Is(err, pgx.ErrNoRows) {
		return Food{}, ErrNotFound
	}
	if err != nil {
		return Food{}, err
	}
	ps, err := s.portionsOf(ctx, []uuid.UUID{r.SmaeFood.ID})
	if err != nil {
		return Food{}, err
	}
	return smaeFood(r.SmaeFood, r.SubgroupCode, r.GroupID, ps[r.SmaeFood.ID]), nil
}

type SearchQuery struct {
	Search  string
	GroupID uuid.UUID
	Source  string // all | smae | custom
	Limit   int
	Offset  int
}

type FoodsPage struct {
	Items  []Food `json:"items"`
	Total  int64  `json:"total"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(s))
}

// SearchFoods mezcla alimentos del catálogo activo y personalizados activos, ordenados por nombre.
func (s *Service) SearchFoods(ctx context.Context, q SearchQuery) (FoodsPage, error) {
	if q.Limit < 1 || q.Limit > 100 {
		q.Limit = 30
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	if q.Source == "" {
		q.Source = "all"
	}
	var items []Food
	var total int64
	need := int32(q.Offset + q.Limit)
	if q.Source != "custom" {
		ed, err := s.ActiveEdition(ctx)
		if err != nil {
			return FoodsPage{}, err
		}
		rows, err := s.q.ListFoods(ctx, db.ListFoodsParams{EditionID: ed.ID, GroupID: q.GroupID, Search: escapeLike(q.Search), PageLimit: need, PageOffset: 0})
		if err != nil {
			return FoodsPage{}, err
		}
		ids := make([]uuid.UUID, 0, len(rows))
		for _, r := range rows {
			ids = append(ids, r.SmaeFood.ID)
		}
		ps, err := s.portionsOf(ctx, ids)
		if err != nil {
			return FoodsPage{}, err
		}
		for _, r := range rows {
			total = r.Total
			items = append(items, smaeFood(r.SmaeFood, r.SubgroupCode, r.GroupID, ps[r.SmaeFood.ID]))
		}
	}
	// Un filtro por grupo SMAE excluye los personalizados (no pertenecen a un grupo oficial).
	if q.Source != "smae" && q.GroupID == uuid.Nil {
		rows, err := s.q.ListCustomFoods(ctx, db.ListCustomFoodsParams{OnlyActive: true, Search: escapeLike(q.Search), PageLimit: need, PageOffset: 0})
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
		byFood := map[uuid.UUID][]db.CustomFoodPortion{}
		for _, p := range ps {
			byFood[p.CustomFoodID] = append(byFood[p.CustomFoodID], p)
		}
		for _, r := range rows {
			items = append(items, customFood(customRow(r), byFood[r.ID]))
		}
		if len(rows) > 0 {
			total += rows[0].Total
		}
	}
	sortByName(items)
	if q.Offset >= len(items) {
		items = nil
	} else {
		end := q.Offset + q.Limit
		if end > len(items) {
			end = len(items)
		}
		items = items[q.Offset:end]
	}
	if items == nil {
		items = []Food{}
	}
	return FoodsPage{Items: items, Total: total, Limit: q.Limit, Offset: q.Offset}, nil
}

func customRow(r db.ListCustomFoodsRow) db.CustomFood {
	return db.CustomFood{
		ID: r.ID, Name: r.Name, Brand: r.Brand, Description: r.Description, BasisQuantity: r.BasisQuantity, BasisUnit: r.BasisUnit, DensityGPerMl: r.DensityGPerMl,
		EnergyKcal: r.EnergyKcal, ProteinG: r.ProteinG, CarbohydratesG: r.CarbohydratesG, LipidsG: r.LipidsG, FiberG: r.FiberG, SourceType: r.SourceType,
		SourceReference: r.SourceReference, Tags: r.Tags, CreatedBy: r.CreatedBy, ValidatedBy: r.ValidatedBy, ValidatedAt: r.ValidatedAt, Status: r.Status,
		EqSubgroupCode: r.EqSubgroupCode, EqReferenceGrams: r.EqReferenceGrams, EqValue: r.EqValue, EqAssignedBy: r.EqAssignedBy, EqAssignedAt: r.EqAssignedAt,
		EqCriterion: r.EqCriterion, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func sortByName(f []Food) {
	for i := 1; i < len(f); i++ {
		for j := i; j > 0 && strings.ToLower(f[j].Name) < strings.ToLower(f[j-1].Name); j-- {
			f[j], f[j-1] = f[j-1], f[j]
		}
	}
}

// ---------- Importación de ediciones (§30.9) ----------
type ImportSubgroup struct{ Code, Name string }
type ImportGroup struct {
	Code      string           `json:"code"`
	Name      string           `json:"name"`
	Tone      string           `json:"tone"`
	Subgroups []ImportSubgroup `json:"subgroups"`
}
type ImportPortion struct {
	Name            string `json:"name"`
	Unit            string `json:"unit"`
	Quantity        string `json:"quantity"`
	GramsEquivalent string `json:"grams_equivalent"`
}
type ImportFood struct {
	Code               string          `json:"code"`
	Name               string          `json:"name"`
	SubgroupCode       string          `json:"subgroup_code"`
	FoodState          string          `json:"food_state"`
	DensityGPerMl      string          `json:"density_g_per_ml"`
	BasisQuantity      string          `json:"basis_quantity"`
	BasisUnit          string          `json:"basis_unit"`
	EnergyKcal         string          `json:"energy_kcal"`
	ProteinG           string          `json:"protein_g"`
	CarbohydratesG     string          `json:"carbohydrates_g"`
	LipidsG            string          `json:"lipids_g"`
	FiberG             string          `json:"fiber_g"`
	EquivReferenceGram string          `json:"equiv_reference_grams"`
	EquivValue         string          `json:"equiv_value"`
	Tags               []string        `json:"tags"`
	SourceReference    string          `json:"source_reference"`
	Portions           []ImportPortion `json:"portions"`
}
type ImportPayload struct {
	Name             string        `json:"name"`
	EditionNumber    int           `json:"edition_number"`
	Publisher        string        `json:"publisher"`
	SourceReference  string        `json:"source_reference"`
	LicenseReference string        `json:"license_reference"`
	EffectiveDate    string        `json:"effective_date"`
	Notes            string        `json:"notes"`
	FileName         string        `json:"file_name"`
	Groups           []ImportGroup `json:"groups"`
	Foods            []ImportFood  `json:"foods"`
}

type ImportReport struct {
	Edition  db.SmaeEdition `json:"edition"`
	Checksum string         `json:"checksum"`
	Foods    int            `json:"foods"`
	Warnings []string       `json:"warnings"`
}

func dec(s string, def string) (decimal.Decimal, error) {
	if strings.TrimSpace(s) == "" {
		s = def
	}
	return decimal.NewFromString(strings.TrimSpace(s))
}

type parsedFood struct {
	f        ImportFood
	basis    decimal.Decimal
	nums     [5]decimal.Decimal // energía, prot, carb, lip, fibra
	refGrams decimal.Decimal
	eqValue  decimal.Decimal
	density  decimal.NullDecimal
	portions []struct {
		p       ImportPortion
		qty, gr decimal.Decimal
	}
}

// validate revisa duplicados, unidades, campos obligatorios y consistencia de nutrientes antes de activar (§30.9).
func validate(p ImportPayload) ([]parsedFood, map[string]string, []string) {
	errs := map[string]string{}
	var warns []string
	if strings.TrimSpace(p.Name) == "" {
		errs["name"] = "el nombre de la edición es obligatorio"
	}
	if _, err := time.Parse("2006-01-02", p.EffectiveDate); err != nil {
		errs["effective_date"] = "usa el formato AAAA-MM-DD"
	}
	if p.EditionNumber < 1 {
		errs["edition_number"] = "el número de edición debe ser positivo"
	}
	if len(p.Foods) == 0 {
		errs["foods"] = "la edición no contiene alimentos"
	}
	subs := map[string]bool{}
	groupCodes := map[string]bool{}
	for _, g := range p.Groups {
		if g.Code == "" || g.Name == "" {
			errs["groups"] = "todos los grupos requieren código y nombre"
		}
		if groupCodes[g.Code] {
			errs["group:"+g.Code] = "código de grupo duplicado"
		}
		groupCodes[g.Code] = true
		for _, sg := range g.Subgroups {
			if subs[sg.Code] {
				errs["subgroup:"+sg.Code] = "código de subgrupo duplicado"
			}
			subs[sg.Code] = true
		}
	}
	seen := map[string]bool{}
	out := make([]parsedFood, 0, len(p.Foods))
	for i, f := range p.Foods {
		key := fmt.Sprintf("foods[%d] %s", i, f.Code)
		if f.Code == "" || strings.TrimSpace(f.Name) == "" {
			errs[key] = "código y nombre son obligatorios"
			continue
		}
		if seen[f.Code] {
			errs[key] = "código de alimento duplicado"
			continue
		}
		seen[f.Code] = true
		if !subs[f.SubgroupCode] {
			errs[key] = "subgrupo inexistente: " + f.SubgroupCode
			continue
		}
		pf := parsedFood{f: f}
		var err error
		bad := func(field string) { errs[key] = "valor numérico inválido en " + field }
		if pf.basis, err = dec(f.BasisQuantity, "100"); err != nil || pf.basis.Sign() <= 0 {
			bad("basis_quantity")
			continue
		}
		if f.BasisUnit != "" && f.BasisUnit != "g" && f.BasisUnit != "ml" {
			errs[key] = "unidad base no válida (g o ml)"
			continue
		}
		vals := []string{f.EnergyKcal, f.ProteinG, f.CarbohydratesG, f.LipidsG, f.FiberG}
		names := []string{"energy_kcal", "protein_g", "carbohydrates_g", "lipids_g", "fiber_g"}
		ok := true
		for j, v := range vals {
			if pf.nums[j], err = dec(v, "0"); err != nil || pf.nums[j].IsNegative() {
				bad(names[j])
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		if pf.refGrams, err = dec(f.EquivReferenceGram, ""); err != nil || pf.refGrams.Sign() <= 0 {
			bad("equiv_reference_grams")
			continue
		}
		if pf.eqValue, err = dec(f.EquivValue, "1"); err != nil || pf.eqValue.Sign() <= 0 {
			bad("equiv_value")
			continue
		}
		if f.DensityGPerMl != "" {
			d, err := decimal.NewFromString(f.DensityGPerMl)
			if err != nil || d.Sign() <= 0 {
				bad("density_g_per_ml")
				continue
			}
			pf.density = decimal.NullDecimal{Decimal: d, Valid: true}
		}
		units := map[string]bool{}
		for _, pr := range f.Portions {
			q, e1 := dec(pr.Quantity, "1")
			g, e2 := dec(pr.GramsEquivalent, "")
			if e1 != nil || e2 != nil || q.Sign() <= 0 || g.Sign() <= 0 || pr.Unit == "" || pr.Unit == "g" || pr.Unit == "ml" || units[pr.Unit] {
				errs[key] = "medida casera inválida o duplicada: " + pr.Unit
				ok = false
				break
			}
			units[pr.Unit] = true
			pf.portions = append(pf.portions, struct {
				p       ImportPortion
				qty, gr decimal.Decimal
			}{pr, q, g})
		}
		if !ok || errs[key] != "" {
			continue
		}
		// Consistencia: 4·P + 4·C + 9·L debería aproximar la energía (advertencia, no rechazo).
		kcal := pf.nums[0]
		calc := pf.nums[1].Mul(decimal.NewFromInt(4)).Add(pf.nums[2].Mul(decimal.NewFromInt(4))).Add(pf.nums[3].Mul(decimal.NewFromInt(9)))
		if kcal.GreaterThan(decimal.NewFromInt(20)) && calc.Sub(kcal).Abs().GreaterThan(kcal.Mul(decimal.RequireFromString("0.25"))) {
			warns = append(warns, fmt.Sprintf("%s: la energía (%s kcal) difiere de la calculada por macros (%s kcal)", f.Name, kcal, calc.Round(0)))
		}
		out = append(out, pf)
	}
	return out, errs, warns
}

func checksum(p ImportPayload) string {
	b, _ := json.Marshal(p)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// ImportEdition valida e importa una edición como BORRADOR (no sobrescribe la anterior).
// Cada intento, aceptado o rechazado, deja un lote trazable con su checksum.
func (s *Service) ImportEdition(ctx context.Context, a Actor, p ImportPayload) (ImportReport, error) {
	sum := checksum(p)
	parsed, errs, warns := validate(p)
	if len(errs) > 0 {
		var parts []string
		for k, v := range errs {
			parts = append(parts, k+": "+v)
		}
		summary := strings.Join(parts, "; ")
		if len(summary) > 2000 {
			summary = summary[:2000]
		}
		s.rejectedBatch(ctx, a, p, sum, summary)
		return ImportReport{}, ValidationError(errs)
	}
	eff, _ := time.Parse("2006-01-02", p.EffectiveDate)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ImportReport{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	ed, err := q.CreateEdition(ctx, db.CreateEditionParams{
		Name: p.Name, EditionNumber: int32(p.EditionNumber), Publisher: p.Publisher, SourceReference: p.SourceReference, LicenseReference: p.LicenseReference,
		EffectiveDate: pgtype.Date{Time: eff, Valid: true}, Status: "draft", Notes: p.Notes, ImportedBy: uuid.NullUUID{UUID: a.ID, Valid: a.ID != uuid.Nil},
	})
	if err != nil {
		return ImportReport{}, err
	}
	subIDs := map[string]uuid.UUID{}
	for gi, g := range p.Groups {
		tone := g.Tone
		if tone == "" {
			tone = "lavanda"
		}
		gr, err := q.InsertGroup(ctx, db.InsertGroupParams{EditionID: ed.ID, Code: g.Code, Name: g.Name, SortOrder: int32(gi + 1), Tone: tone})
		if err != nil {
			return ImportReport{}, ValidationError{"groups": "tono o datos de grupo inválidos: " + err.Error()}
		}
		for si, sg := range g.Subgroups {
			row, err := q.InsertSubgroup(ctx, db.InsertSubgroupParams{GroupID: gr.ID, Code: sg.Code, Name: sg.Name, SortOrder: int32(si + 1)})
			if err != nil {
				return ImportReport{}, err
			}
			subIDs[sg.Code] = row.ID
		}
	}
	for _, pf := range parsed {
		unit := pf.f.BasisUnit
		if unit == "" {
			unit = "g"
		}
		id, err := q.InsertFood(ctx, db.InsertFoodParams{
			EditionID: ed.ID, SubgroupID: subIDs[pf.f.SubgroupCode], Code: pf.f.Code, Name: pf.f.Name, FoodState: pf.f.FoodState, EdiblePct: decimal.NewFromInt(100),
			DensityGPerMl: pf.density, BasisQuantity: pf.basis, BasisUnit: unit, EnergyKcal: pf.nums[0], ProteinG: pf.nums[1], CarbohydratesG: pf.nums[2],
			LipidsG: pf.nums[3], FiberG: pf.nums[4], EquivReferenceGrams: pf.refGrams, EquivValue: pf.eqValue, Tags: nilTags(pf.f.Tags), SourceReference: pf.f.SourceReference,
		})
		if err != nil {
			return ImportReport{}, err
		}
		for i, pr := range pf.portions {
			if err := q.InsertPortion(ctx, db.InsertPortionParams{FoodID: id, Name: pr.p.Name, Unit: pr.p.Unit, Quantity: pr.qty, GramsEquivalent: pr.gr, IsReference: i == 0}); err != nil {
				return ImportReport{}, err
			}
		}
	}
	if _, err := q.InsertImportBatch(ctx, db.InsertImportBatchParams{
		EditionID: uuid.NullUUID{UUID: ed.ID, Valid: true}, SourceFileName: p.FileName, Checksum: sum, ImportedBy: uuid.NullUUID{UUID: a.ID, Valid: a.ID != uuid.Nil}, RowCount: int32(len(parsed)), Status: "ok",
		ErrorSummary: strings.Join(warns, "; "),
	}); err != nil {
		return ImportReport{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ImportReport{}, err
	}
	s.rec(ctx, a, "smae.import", "smae_edition", ed.ID, map[string]any{"foods": len(parsed), "checksum": sum, "warnings": len(warns)})
	if warns == nil {
		warns = []string{}
	}
	return ImportReport{Edition: ed, Checksum: sum, Foods: len(parsed), Warnings: warns}, nil
}

// rejectedBatch deja constancia de una importación rechazada (en su propia operación, sin edición).
func (s *Service) rejectedBatch(ctx context.Context, a Actor, p ImportPayload, sum, summary string) {
	if _, err := s.q.InsertImportBatch(ctx, db.InsertImportBatchParams{
		SourceFileName: p.FileName, Checksum: sum, ImportedBy: uuid.NullUUID{UUID: a.ID, Valid: a.ID != uuid.Nil}, RowCount: int32(len(p.Foods)), Status: "rejected", ErrorSummary: summary,
	}); err != nil {
		s.log.ErrorContext(ctx, "import_batch_failed", slog.Any("error", err))
	}
	s.rec(ctx, a, "smae.import_rejected", "smae_edition", uuid.Nil, map[string]any{"checksum": sum, "file": p.FileName, "summary": truncate(summary, 500)})
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
