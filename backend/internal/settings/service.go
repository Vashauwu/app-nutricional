// Package settings guarda la configuración de la plataforma (marca, región, cuotas, alertas) y publica
// versiones de los documentos legales (MVP_SPEC §19, §18.2, §14, §4.1).
package settings

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/audit"
)

type ValidationError map[string]string

func (v ValidationError) Error() string { return "datos inválidos" }

type Actor struct {
	ID        uuid.UUID
	RequestID string
}

// ---------- Secciones ----------
type Brand struct {
	BusinessName  string     `json:"business_name"`
	Tagline       string     `json:"tagline"`
	Primary       string     `json:"primary"`
	Secondary     string     `json:"secondary"`
	LogoFileID    *uuid.UUID `json:"logo_file_id"`
	PhotoFileID   *uuid.UUID `json:"photo_file_id"`
	Phone         string     `json:"phone"`
	Email         string     `json:"email"`
	Address       string     `json:"address"`
	Credentials   string     `json:"credentials"`
	LicenseNumber string     `json:"license_number"`
}

type Region struct {
	Timezone  string `json:"timezone"`
	WeekStart string `json:"week_start"` // mon | sun
}

type Storage struct {
	DefaultQuotaBytes int64 `json:"default_quota_bytes"`
	MaxImageBytes     int64 `json:"max_image_bytes"`
	MaxPdfBytes       int64 `json:"max_pdf_bytes"`
	WarnThresholdPct  int   `json:"warn_threshold_pct"`
}

type Rule struct {
	ID       string   `json:"id"`
	Keyword  string   `json:"keyword"`
	Triggers []string `json:"triggers"`
	Level    string   `json:"level"` // info | warning | critical
	Message  string   `json:"message"`
	Enabled  bool     `json:"enabled"`
}

type Alerts struct {
	EnergyTolerancePct  decimal.Decimal `json:"energy_tolerance_pct"`
	MacroTolerancePct   decimal.Decimal `json:"macro_tolerance_pct"`
	EquivalentTolerance decimal.Decimal `json:"equivalent_tolerance"`
	ClinicalRules       []Rule          `json:"clinical_rules"`
}

type All struct {
	Brand   Brand   `json:"brand"`
	Region  Region  `json:"region"`
	Storage Storage `json:"storage"`
	Alerts  Alerts  `json:"alerts"`
}

const MB = 1024 * 1024

// Defaults son los valores iniciales; las reglas y umbrales clínicos DEBE validarlos la nutrióloga (§14).
func Defaults() All {
	return All{
		Brand:   Brand{BusinessName: "Nutrición", Tagline: "", Primary: "#514653", Secondary: "#DDD6F2"},
		Region:  Region{Timezone: "America/Mexico_City", WeekStart: "mon"},
		Storage: Storage{DefaultQuotaBytes: 50 * MB, MaxImageBytes: 10 * MB, MaxPdfBytes: 15 * MB, WarnThresholdPct: 80},
		Alerts: Alerts{
			EnergyTolerancePct: decimal.NewFromInt(10), MacroTolerancePct: decimal.NewFromInt(15), EquivalentTolerance: decimal.NewFromInt(1),
			ClinicalRules: []Rule{
				{ID: "r-hta", Keyword: "hipertensión", Triggers: []string{"embutido", "jamón", "sal añadida", "queso panela"}, Level: "warning", Message: "Alimento alto en sodio con hipertensión", Enabled: true},
				{ID: "r-dm", Keyword: "diabetes", Triggers: []string{"miel", "azúcar", "jugo"}, Level: "warning", Message: "Azúcar simple con diabetes", Enabled: true},
				{ID: "r-lip", Keyword: "dislipidemia", Triggers: []string{"frito", "chicharrón", "manteca"}, Level: "warning", Message: "Grasa saturada con dislipidemia", Enabled: true},
			},
		},
	}
}

type Service struct {
	q     *db.Queries
	pool  *pgxpool.Pool
	audit audit.Recorder
	log   *slog.Logger
}

func NewService(pool *pgxpool.Pool, log *slog.Logger) *Service {
	q := db.New(pool)
	return &Service{q: q, pool: pool, audit: audit.Recorder{Q: q, Log: log}, log: log}
}

func (s *Service) rec(ctx context.Context, a Actor, action, section string) {
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: action, ResourceType: "settings", RequestID: a.RequestID, Metadata: map[string]any{"section": section}})
}

func load[T any](ctx context.Context, q *db.Queries, key string, def T) (T, error) {
	row, err := q.GetSetting(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		return def, nil
	}
	if err != nil {
		return def, err
	}
	out := def // los campos ausentes conservan su valor por defecto
	if err := json.Unmarshal(row.Value, &out); err != nil {
		return def, err
	}
	return out, nil
}

func (s *Service) Get(ctx context.Context) (All, error) {
	d := Defaults()
	var out All
	var err error
	if out.Brand, err = load(ctx, s.q, "brand", d.Brand); err != nil {
		return d, err
	}
	if out.Region, err = load(ctx, s.q, "region", d.Region); err != nil {
		return d, err
	}
	if out.Storage, err = load(ctx, s.q, "storage", d.Storage); err != nil {
		return d, err
	}
	out.Alerts, err = load(ctx, s.q, "alerts", d.Alerts)
	if out.Alerts.ClinicalRules == nil {
		out.Alerts.ClinicalRules = []Rule{}
	}
	return out, err
}

func (s *Service) Storage(ctx context.Context) (Storage, error) {
	return load(ctx, s.q, "storage", Defaults().Storage)
}
func (s *Service) Alerts(ctx context.Context) (Alerts, error) {
	return load(ctx, s.q, "alerts", Defaults().Alerts)
}
func (s *Service) Region(ctx context.Context) (Region, error) {
	return load(ctx, s.q, "region", Defaults().Region)
}

// PublicBrand es lo único visible sin sesión (pantalla de ingreso): nunca contacto ni credenciales.
type PublicBrand struct {
	BusinessName string `json:"business_name"`
	Tagline      string `json:"tagline"`
	Primary      string `json:"primary"`
	Secondary    string `json:"secondary"`
}

func (s *Service) PublicBrand(ctx context.Context) (PublicBrand, error) {
	b, err := load(ctx, s.q, "brand", Defaults().Brand)
	return PublicBrand{BusinessName: b.BusinessName, Tagline: b.Tagline, Primary: b.Primary, Secondary: b.Secondary}, err
}

func (s *Service) save(ctx context.Context, a Actor, key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if err := s.q.UpsertSetting(ctx, db.UpsertSettingParams{Key: key, Value: b, UpdatedBy: uuid.NullUUID{UUID: a.ID, Valid: a.ID != uuid.Nil}}); err != nil {
		return err
	}
	s.rec(ctx, a, "settings."+key, key)
	return nil
}

// ---------- Contraste WCAG (§19.3, §20.1) ----------
var hexRe = regexp.MustCompile(`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

func luminance(hex string) float64 {
	h := strings.TrimPrefix(hex, "#")
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	ch := func(i int) float64 {
		n, _ := strconv.ParseUint(h[i:i+2], 16, 8)
		v := float64(n) / 255
		if v <= 0.03928 {
			return v / 12.92
		}
		return math.Pow((v+0.055)/1.055, 2.4)
	}
	return 0.2126*ch(0) + 0.7152*ch(2) + 0.0722*ch(4)
}

// Contrast calcula la razón de contraste WCAG entre dos colores hexadecimales.
func Contrast(a, b string) float64 {
	l1, l2 := luminance(a), luminance(b)
	if l1 < l2 {
		l1, l2 = l2, l1
	}
	return (l1 + 0.05) / (l2 + 0.05)
}

const ivory = "#FAF7F2"

func (s *Service) UpdateBrand(ctx context.Context, a Actor, b Brand) (Brand, error) {
	errs := ValidationError{}
	b.BusinessName = strings.TrimSpace(b.BusinessName)
	if b.BusinessName == "" || len(b.BusinessName) > 80 {
		errs["business_name"] = "el nombre comercial es obligatorio (máx. 80 caracteres)"
	}
	if !hexRe.MatchString(b.Primary) {
		errs["primary"] = "usa un color hexadecimal, p. ej. #514653"
	} else if Contrast(b.Primary, ivory) < 4.5 {
		errs["primary"] = "contraste insuficiente (mínimo 4.5:1 sobre el fondo) para botones y texto"
	}
	if !hexRe.MatchString(b.Secondary) {
		errs["secondary"] = "usa un color hexadecimal"
	}
	if b.Email != "" && !strings.Contains(b.Email, "@") {
		errs["email"] = "correo no válido"
	}
	for k, v := range map[string]string{"tagline": b.Tagline, "phone": b.Phone, "address": b.Address, "credentials": b.Credentials, "license_number": b.LicenseNumber} {
		if len(v) > 300 {
			errs[k] = "máximo 300 caracteres"
		}
	}
	if len(errs) > 0 {
		return Brand{}, errs
	}
	return b, s.save(ctx, a, "brand", b)
}

func (s *Service) UpdateRegion(ctx context.Context, a Actor, r Region) (Region, error) {
	errs := ValidationError{}
	if _, err := time.LoadLocation(r.Timezone); err != nil || r.Timezone == "" {
		errs["timezone"] = "zona horaria no válida"
	}
	if r.WeekStart != "mon" && r.WeekStart != "sun" {
		errs["week_start"] = "la semana inicia en mon o sun"
	}
	if len(errs) > 0 {
		return Region{}, errs
	}
	return r, s.save(ctx, a, "region", r)
}

func (s *Service) UpdateStorage(ctx context.Context, a Actor, st Storage) (Storage, error) {
	errs := ValidationError{}
	if st.DefaultQuotaBytes < MB || st.DefaultQuotaBytes > 100*1024*MB {
		errs["default_quota_bytes"] = "la cuota base debe estar entre 1 MB y 100 GB"
	}
	if st.MaxImageBytes < 100*1024 || st.MaxImageBytes > 50*MB {
		errs["max_image_bytes"] = "el límite de imagen debe estar entre 100 KB y 50 MB"
	}
	if st.MaxPdfBytes < 100*1024 || st.MaxPdfBytes > 50*MB {
		errs["max_pdf_bytes"] = "el límite de PDF debe estar entre 100 KB y 50 MB"
	}
	if st.WarnThresholdPct < 1 || st.WarnThresholdPct > 100 {
		errs["warn_threshold_pct"] = "el umbral debe estar entre 1 y 100"
	}
	if len(errs) > 0 {
		return Storage{}, errs
	}
	return st, s.save(ctx, a, "storage", st)
}

func (s *Service) UpdateAlerts(ctx context.Context, a Actor, al Alerts) (Alerts, error) {
	errs := ValidationError{}
	in := func(d decimal.Decimal, lo, hi int64) bool {
		return d.GreaterThanOrEqual(decimal.NewFromInt(lo)) && d.LessThanOrEqual(decimal.NewFromInt(hi))
	}
	if !in(al.EnergyTolerancePct, 1, 50) {
		errs["energy_tolerance_pct"] = "la tolerancia debe estar entre 1 y 50 %"
	}
	if !in(al.MacroTolerancePct, 1, 50) {
		errs["macro_tolerance_pct"] = "la tolerancia debe estar entre 1 y 50 %"
	}
	if !in(al.EquivalentTolerance, 0, 10) {
		errs["equivalent_tolerance"] = "la tolerancia debe estar entre 0 y 10 equivalentes"
	}
	if len(al.ClinicalRules) > 50 {
		errs["clinical_rules"] = "máximo 50 reglas"
	}
	for i := range al.ClinicalRules {
		r := &al.ClinicalRules[i]
		if r.ID == "" {
			r.ID = uuid.NewString()
		}
		r.Keyword, r.Message = strings.TrimSpace(r.Keyword), strings.TrimSpace(r.Message)
		trig := make([]string, 0, len(r.Triggers))
		for _, t := range r.Triggers {
			if t = strings.TrimSpace(t); len(t) >= 3 && len(t) <= 60 {
				trig = append(trig, t)
			}
		}
		r.Triggers = trig
		if r.Keyword == "" || r.Message == "" || len(trig) == 0 || len(trig) > 30 {
			errs["clinical_rules["+strconv.Itoa(i)+"]"] = "cada regla requiere indicación, mensaje y entre 1 y 30 palabras de 3 o más letras"
		}
		if r.Level != "info" && r.Level != "warning" && r.Level != "critical" {
			errs["clinical_rules["+strconv.Itoa(i)+"].level"] = "nivel no válido"
		}
	}
	if len(errs) > 0 {
		return Alerts{}, errs
	}
	if al.ClinicalRules == nil {
		al.ClinicalRules = []Rule{}
	}
	return al, s.save(ctx, a, "alerts", al)
}

// ---------- Documentos legales versionados (§4.1) ----------
type ConsentVersion struct {
	ID          uuid.UUID `json:"id"`
	Type        string    `json:"document_type"`
	Version     int32     `json:"version"`
	Title       string    `json:"title"`
	Content     string    `json:"content"`
	PublishedAt time.Time `json:"published_at"`
	IsActive    bool      `json:"is_active"`
	Acceptances int64     `json:"acceptances"`
}

func (s *Service) ConsentVersions(ctx context.Context, typ string) ([]ConsentVersion, error) {
	if typ != "privacy" && typ != "informed" {
		return nil, ValidationError{"type": "el tipo debe ser privacy o informed"}
	}
	rows, err := s.q.ListConsentVersions(ctx, typ)
	if err != nil {
		return nil, err
	}
	out := []ConsentVersion{}
	for _, r := range rows {
		out = append(out, ConsentVersion{ID: r.ID, Type: r.DocumentType, Version: r.Version, Title: r.Title, Content: r.Content, PublishedAt: r.PublishedAt.Time, IsActive: r.IsActive, Acceptances: r.Acceptances})
	}
	return out, nil
}

// PublishConsent crea una versión NUEVA y la vuelve vigente; las anteriores no se sobrescriben. Los pacientes
// que aún no han aceptado la versión nueva quedan con el expediente clínico restringido hasta hacerlo.
func (s *Service) PublishConsent(ctx context.Context, a Actor, typ, title, content string) (ConsentVersion, error) {
	errs := ValidationError{}
	if typ != "privacy" && typ != "informed" {
		errs["type"] = "el tipo debe ser privacy o informed"
	}
	if strings.TrimSpace(title) == "" || len(title) > 160 {
		errs["title"] = "el título es obligatorio"
	}
	if len(strings.TrimSpace(content)) < 20 || len(content) > 100_000 {
		errs["content"] = "el texto es obligatorio (mínimo 20 caracteres)"
	}
	if len(errs) > 0 {
		return ConsentVersion{}, errs
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ConsentVersion{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if err := q.DeactivateConsentType(ctx, typ); err != nil {
		return ConsentVersion{}, err
	}
	d, err := q.InsertConsentVersion(ctx, db.InsertConsentVersionParams{DocumentType: typ, Title: strings.TrimSpace(title), Content: content})
	if err != nil {
		return ConsentVersion{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ConsentVersion{}, err
	}
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: "consent.publish", ResourceType: "consent_document", ResourceID: d.ID, RequestID: a.RequestID, Metadata: map[string]any{"type": typ, "version": d.Version}})
	return ConsentVersion{ID: d.ID, Type: d.DocumentType, Version: d.Version, Title: d.Title, Content: d.Content, PublishedAt: d.PublishedAt.Time, IsActive: d.IsActive}, nil
}
