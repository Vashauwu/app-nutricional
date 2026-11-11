// Package tracking registra el seguimiento de comidas de la paciente (MVP_SPEC §12.3–12.4): estado por comida,
// fotografías y comentarios por tiempo de comida, y cálculo de cumplimiento.
package tracking

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/audit"
	"github.com/nutri/app-nutricional/backend/internal/storage"
)

var (
	ErrNotFound       = errors.New("no encontrado")
	ErrConsentPending = errors.New("el expediente clínico está restringido hasta que se acepten el aviso de privacidad y el consentimiento informado")
	ErrUnavailable    = errors.New("las fotografías no están disponibles porque el almacenamiento no está configurado")
)

const (
	MaxPhotosPerEntry = 3
	MaxCommentLen     = 1000
)

type ValidationError map[string]string

func (v ValidationError) Error() string { return "datos inválidos" }

type Actor struct {
	ID        uuid.UUID
	Role      string // patient | nutritionist
	Name      string
	RequestID string
}

// Images es el subconjunto del servicio de archivos que usa el seguimiento (nil si no hay almacenamiento).
type Images interface {
	UploadImage(ctx context.Context, a storage.Actor, kind string, owner *uuid.UUID, data []byte) (storage.FileView, error)
}

type Service struct {
	pool   db.DBTX
	q      *db.Queries
	images Images
	audit  audit.Recorder
	log    *slog.Logger
	loc    *time.Location
	now    func() time.Time
}

func NewService(pool db.DBTX, images Images, tz string, log *slog.Logger) *Service {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	q := db.New(pool)
	return &Service{pool: pool, q: q, images: images, audit: audit.Recorder{Q: q, Log: log}, log: log, loc: loc, now: time.Now}
}

func (s *Service) Today() time.Time {
	n := s.now().In(s.loc)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
}

func (s *Service) rec(ctx context.Context, a Actor, action string, id uuid.UUID, meta map[string]any) {
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: action, ResourceType: "tracking_entry", ResourceID: id, RequestID: a.RequestID, Metadata: meta})
}

// ---------- Vistas ----------
type PhotoView struct {
	ID         uuid.UUID `json:"id"`
	URL        string    `json:"url"`
	ThumbURL   string    `json:"thumb_url"`
	Alt        string    `json:"alt"`
	UploadedAt time.Time `json:"uploaded_at"`
}

type CommentView struct {
	ID         uuid.UUID `json:"id"`
	AuthorRole string    `json:"author_role"`
	AuthorName string    `json:"author_name"`
	Body       string    `json:"body"`
	At         time.Time `json:"at"`
}

type EntryView struct {
	ID             uuid.UUID     `json:"id"`
	PatientID      uuid.UUID     `json:"patient_id"`
	PatientName    string        `json:"patient_name,omitempty"`
	PlanID         uuid.UUID     `json:"plan_id"`
	ItemID         uuid.UUID     `json:"item_id"`
	Date           string        `json:"date"`
	SlotName       string        `json:"slot_name"`
	DishID         uuid.UUID     `json:"dish_id"`
	DishVersion    int32         `json:"dish_version"`
	DishName       string        `json:"dish_name"`
	Status         string        `json:"status"`
	RecordedAt     time.Time     `json:"recorded_at"`
	PatientComment string        `json:"patient_comment"`
	NeedsReview    bool          `json:"needs_review"`
	Photos         []PhotoView   `json:"photos"`
	Thread         []CommentView `json:"thread"`
}

func entryView(e db.TrackingEntry) EntryView {
	return EntryView{ID: e.ID, PatientID: e.PatientID, PlanID: e.PlanID, ItemID: e.ItemID, Date: e.EntryDate.Time.Format("2006-01-02"), SlotName: e.SlotName,
		DishID: e.DishID, DishVersion: e.DishVersion, DishName: e.DishName, Status: e.Status, RecordedAt: e.RecordedAt.Time, PatientComment: e.PatientComment,
		NeedsReview: e.NeedsReview, Photos: []PhotoView{}, Thread: []CommentView{}}
}

// hydrate agrega fotos y conversación a las entradas (dos consultas para todo el lote).
func (s *Service) hydrate(ctx context.Context, views []EntryView) error {
	if len(views) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, len(views))
	idx := map[uuid.UUID]int{}
	for i, v := range views {
		ids[i] = v.ID
		idx[v.ID] = i
	}
	photos, err := s.q.ListPhotosForEntries(ctx, ids)
	if err != nil {
		return err
	}
	for _, p := range photos {
		u := "/api/v1/files/" + p.FileObjectID.String()
		i := idx[p.EntryID]
		views[i].Photos = append(views[i].Photos, PhotoView{ID: p.ID, URL: u, ThumbURL: u + "?thumb=1", Alt: p.Alt, UploadedAt: p.UploadedAt.Time})
	}
	comments, err := s.q.ListCommentsForEntries(ctx, ids)
	if err != nil {
		return err
	}
	for _, c := range comments {
		i := idx[c.EntryID]
		views[i].Thread = append(views[i].Thread, CommentView{ID: c.ID, AuthorRole: c.AuthorRole, AuthorName: c.AuthorName, Body: c.Body, At: c.CreatedAt.Time})
	}
	return nil
}

func (s *Service) one(ctx context.Context, e db.TrackingEntry) (EntryView, error) {
	vs := []EntryView{entryView(e)}
	if err := s.hydrate(ctx, vs); err != nil {
		return EntryView{}, err
	}
	return vs[0], nil
}

// ---------- Registro de la paciente ----------

// Record marca una comida como realizada u omitida. La comida debe pertenecer al plan PUBLICADO de la paciente y no
// ser futura. El registro queda ligado a la versión exacta del platillo asignada (§12.3).
func (s *Service) Record(ctx context.Context, a Actor, patient, item uuid.UUID, status string, comment *string) (EntryView, error) {
	errs := ValidationError{}
	if status != "done" && status != "skipped" {
		errs["status"] = "usa «done» o «skipped»"
	}
	var c pgtype.Text
	if comment != nil {
		t := strings.TrimSpace(*comment)
		if utf8.RuneCountInString(t) > MaxCommentLen {
			errs["comment"] = "máximo 1000 caracteres"
		}
		c = pgtype.Text{String: t, Valid: true}
	}
	if len(errs) > 0 {
		return EntryView{}, errs
	}
	it, err := s.q.TrackableItem(ctx, db.TrackableItemParams{ID: item, PatientID: patient})
	if errors.Is(err, pgx.ErrNoRows) {
		return EntryView{}, ErrNotFound
	}
	if err != nil {
		return EntryView{}, err
	}
	if it.PlanDate.Time.After(s.Today()) {
		return EntryView{}, ValidationError{"item": "todavía no puedes registrar comidas de días futuros"}
	}
	e, err := s.q.UpsertEntry(ctx, db.UpsertEntryParams{PatientID: patient, PlanID: it.PlanID, ItemID: item, EntryDate: it.PlanDate, SlotName: it.SlotName,
		DishID: it.DishID, DishVersion: it.DishVersion, DishName: it.DishName, Status: status, Comment: c})
	if errors.Is(err, pgx.ErrNoRows) { // el registro existe y es de otra paciente
		return EntryView{}, ErrNotFound
	}
	if err != nil {
		return EntryView{}, err
	}
	s.rec(ctx, a, "tracking.record", e.ID, map[string]any{"status": status})
	return s.one(ctx, e)
}

// Clear elimina un registro propio solo si no tiene fotografías ni comentarios (conserva trazabilidad).
func (s *Service) Clear(ctx context.Context, a Actor, patient, entry uuid.UUID) error {
	e, err := s.q.GetEntry(ctx, entry)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && e.PatientID != patient) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	n, err := s.q.DeleteEntryIfEmpty(ctx, db.DeleteEntryIfEmptyParams{ID: entry, PatientID: patient})
	if err != nil {
		return err
	}
	if n == 0 {
		return ValidationError{"entry": "este registro ya tiene fotografías o comentarios y no puede quitarse; cambia su estado en su lugar"}
	}
	s.rec(ctx, a, "tracking.clear", entry, nil)
	return nil
}

// owned carga una entrada verificando propiedad cuando actúa la paciente (patient != Nil).
func (s *Service) owned(ctx context.Context, patient, entry uuid.UUID) (db.TrackingEntry, error) {
	e, err := s.q.GetEntry(ctx, entry)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.TrackingEntry{}, ErrNotFound
	}
	if err != nil {
		return db.TrackingEntry{}, err
	}
	if patient != uuid.Nil && e.PatientID != patient {
		return db.TrackingEntry{}, ErrNotFound
	}
	return e, nil
}

// AddComment agrega un mensaje al hilo del tiempo de comida. Una respuesta de la nutrióloga cierra la revisión;
// un comentario de la paciente la reabre. patient == Nil cuando comenta la nutrióloga.
func (s *Service) AddComment(ctx context.Context, a Actor, patient, entry uuid.UUID, body string) (EntryView, error) {
	body = strings.TrimSpace(body)
	if body == "" || utf8.RuneCountInString(body) > MaxCommentLen {
		return EntryView{}, ValidationError{"body": "escribe un comentario de hasta 1000 caracteres"}
	}
	e, err := s.owned(ctx, patient, entry)
	if err != nil {
		return EntryView{}, err
	}
	if _, err := s.q.InsertComment(ctx, db.InsertCommentParams{EntryID: e.ID, AuthorUserID: a.ID, AuthorRole: a.Role, Body: body}); err != nil {
		return EntryView{}, err
	}
	if err := s.q.SetEntryNeedsReview(ctx, db.SetEntryNeedsReviewParams{ID: e.ID, NeedsReview: a.Role == "patient"}); err != nil {
		return EntryView{}, err
	}
	s.rec(ctx, a, "tracking.comment", e.ID, nil)
	e, _ = s.q.GetEntry(ctx, e.ID)
	return s.one(ctx, e)
}

// AddPhoto procesa y guarda una fotografía privada de la comida (límite por registro y cuota de la paciente).
func (s *Service) AddPhoto(ctx context.Context, a Actor, patient, entry uuid.UUID, alt string, data []byte) (EntryView, error) {
	if s.images == nil {
		return EntryView{}, ErrUnavailable
	}
	e, err := s.owned(ctx, patient, entry)
	if err != nil {
		return EntryView{}, err
	}
	if utf8.RuneCountInString(alt) > 200 {
		return EntryView{}, ValidationError{"alt": "máximo 200 caracteres"}
	}
	n, err := s.q.CountEntryPhotos(ctx, e.ID)
	if err != nil {
		return EntryView{}, err
	}
	if n >= MaxPhotosPerEntry {
		return EntryView{}, ValidationError{"file": "ya alcanzaste el máximo de 3 fotografías en esta comida"}
	}
	owner := e.PatientID
	f, err := s.images.UploadImage(ctx, storage.Actor{ID: a.ID, RequestID: a.RequestID}, "tracking_photo", &owner, data)
	if err != nil {
		return EntryView{}, err
	}
	if _, err := s.q.InsertTrackingPhoto(ctx, db.InsertTrackingPhotoParams{EntryID: e.ID, FileObjectID: f.ID, Alt: strings.TrimSpace(alt)}); err != nil {
		return EntryView{}, err
	}
	if err := s.q.SetEntryNeedsReview(ctx, db.SetEntryNeedsReviewParams{ID: e.ID, NeedsReview: true}); err != nil {
		return EntryView{}, err
	}
	s.rec(ctx, a, "tracking.photo", e.ID, nil)
	return s.one(ctx, e)
}

// MarkReviewed lo usa la nutrióloga para quitar el registro de la bandeja de pendientes.
func (s *Service) MarkReviewed(ctx context.Context, a Actor, entry uuid.UUID) error {
	n, err := s.q.MarkEntryReviewed(ctx, entry)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.rec(ctx, a, "tracking.review", entry, nil)
	return nil
}

// ---------- Consultas ----------
type FeedQuery struct {
	PatientID *uuid.UUID
	Kind      string
	Search    string
	From, To  *time.Time
	Page      int
	PageSize  int
}

type Page struct {
	Items    []EntryView `json:"items"`
	Total    int         `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"page_size"`
	Pending  int         `json:"pending_review"`
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func nullDate(t *time.Time) pgtype.Date {
	if t == nil {
		return pgtype.Date{}
	}
	return pgtype.Date{Time: *t, Valid: true}
}

func (s *Service) Feed(ctx context.Context, q FeedQuery) (Page, error) {
	switch q.Kind {
	case "", "photos", "comments", "review", "skipped":
	default:
		return Page{}, ValidationError{"kind": "filtro no válido"}
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 || q.PageSize > 100 {
		q.PageSize = 20
	}
	var pid uuid.NullUUID
	if q.PatientID != nil {
		pid = uuid.NullUUID{UUID: *q.PatientID, Valid: true}
	}
	rows, err := s.q.ListEntries(ctx, db.ListEntriesParams{PatientID: pid, FromDate: nullDate(q.From), ToDate: nullDate(q.To), Kind: q.Kind,
		Search: escapeLike(strings.TrimSpace(q.Search)), PageLimit: int32(q.PageSize), PageOffset: int32((q.Page - 1) * q.PageSize)})
	if err != nil {
		return Page{}, err
	}
	out := Page{Items: make([]EntryView, 0, len(rows)), Page: q.Page, PageSize: q.PageSize}
	for _, r := range rows {
		v := entryView(db.TrackingEntry{ID: r.ID, PatientID: r.PatientID, PlanID: r.PlanID, ItemID: r.ItemID, EntryDate: r.EntryDate, SlotName: r.SlotName, DishID: r.DishID,
			DishVersion: r.DishVersion, DishName: r.DishName, Status: r.Status, RecordedAt: r.RecordedAt, UpdatedAt: r.UpdatedAt, PatientComment: r.PatientComment, NeedsReview: r.NeedsReview})
		v.PatientName = r.PatientName
		out.Items = append(out.Items, v)
		out.Total = int(r.Total)
	}
	if err := s.hydrate(ctx, out.Items); err != nil {
		return Page{}, err
	}
	if out.Pending, err = s.pending(ctx); err != nil {
		return Page{}, err
	}
	return out, nil
}

func (s *Service) pending(ctx context.Context) (int, error) {
	n, err := s.q.CountPendingReview(ctx)
	return int(n), err
}

// ---------- Cumplimiento (§25.2) ----------
// Criterio aplicado: comidas realizadas ÷ comidas programadas hasta hoy en planes no borrador.
// Las omitidas y las sin registro no suman. Es una propuesta pendiente de validar por la nutrióloga.
type Compliance struct {
	From    string          `json:"from"`
	To      string          `json:"to"`
	Planned int             `json:"planned"`
	Done    int             `json:"done"`
	Skipped int             `json:"skipped"`
	Pending int             `json:"pending"`
	Pct     *int            `json:"pct"`
	Days    []ComplianceDay `json:"days"`
}

type ComplianceDay struct {
	Date    string `json:"date"`
	Planned int    `json:"planned"`
	Done    int    `json:"done"`
	Skipped int    `json:"skipped"`
	Pct     *int   `json:"pct"`
}

func pct(done, planned int) *int {
	if planned == 0 {
		return nil
	}
	v := (done*100 + planned/2) / planned
	return &v
}

// Compliance calcula el periodo [from, to] recortado a hoy; por defecto, los últimos 7 días.
func (s *Service) Compliance(ctx context.Context, patient uuid.UUID, from, to *time.Time) (Compliance, error) {
	today := s.Today()
	end := today
	if to != nil && to.Before(today) {
		end = *to
	}
	start := end.AddDate(0, 0, -6)
	if from != nil {
		start = *from
	}
	if start.After(end) {
		return Compliance{}, ValidationError{"from": "la fecha inicial debe ser anterior a la final"}
	}
	if end.Sub(start) > 366*24*time.Hour {
		return Compliance{}, ValidationError{"from": "el periodo máximo es de un año"}
	}
	c, err := s.q.ComplianceCounts(ctx, db.ComplianceCountsParams{PatientID: patient, PlanDate: nullDate(&start), PlanDate_2: nullDate(&end)})
	if err != nil {
		return Compliance{}, err
	}
	days, err := s.q.ComplianceByDay(ctx, db.ComplianceByDayParams{PatientID: patient, PlanDate: nullDate(&start), PlanDate_2: nullDate(&end)})
	if err != nil {
		return Compliance{}, err
	}
	out := Compliance{From: start.Format("2006-01-02"), To: end.Format("2006-01-02"), Planned: int(c.Planned), Done: int(c.Done), Skipped: int(c.Skipped),
		Pending: int(c.Planned - c.Done - c.Skipped), Pct: pct(int(c.Done), int(c.Planned)), Days: []ComplianceDay{}}
	for _, d := range days {
		out.Days = append(out.Days, ComplianceDay{Date: d.Day.Time.Format("2006-01-02"), Planned: int(d.Planned), Done: int(d.Done), Skipped: int(d.Skipped), Pct: pct(int(d.Done), int(d.Planned))})
	}
	return out, nil
}
