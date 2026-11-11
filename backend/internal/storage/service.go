package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/disintegration/imaging"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/image/webp"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/audit"
	"github.com/nutri/app-nutricional/backend/internal/settings"
)

var (
	ErrNotFound       = errors.New("no encontrado")
	ErrQuotaExceeded  = errors.New("la cuota de almacenamiento no alcanza para este archivo")
	ErrTooLarge       = errors.New("el archivo supera el tamaño máximo permitido")
	ErrConsentPending = errors.New("el expediente clínico está restringido hasta que se acepten el aviso de privacidad y el consentimiento informado")
	ErrUnavailable    = errors.New("el almacenamiento de archivos no está configurado")
)

// ValidationError agrupa errores por campo (también para archivos rechazados).
type ValidationError map[string]string

func (v ValidationError) Error() string { return "datos inválidos" }

type Actor struct {
	ID        uuid.UUID
	RequestID string
}

// Dependencias del módulo.
type Settings interface {
	Storage(ctx context.Context) (settings.Storage, error)
}
type Patients interface {
	Get(ctx context.Context, id uuid.UUID) (db.Patient, error)
	ConsentComplete(ctx context.Context, id uuid.UUID) (bool, error)
}

type Service struct {
	q        *db.Queries
	store    ObjectStore
	settings Settings
	patients Patients
	audit    audit.Recorder
	log      *slog.Logger
	private  string
	public   string
}

func NewService(pool db.DBTX, store ObjectStore, st Settings, p Patients, privateBucket, publicBucket string, log *slog.Logger) *Service {
	q := db.New(pool)
	return &Service{q: q, store: store, settings: st, patients: p, audit: audit.Recorder{Q: q, Log: log}, log: log, private: privateBucket, public: publicBucket}
}

func (s *Service) bucket(visibility string) string {
	if visibility == "public" {
		return s.public
	}
	return s.private
}

func (s *Service) rec(ctx context.Context, a Actor, action string, id uuid.UUID, meta map[string]any) {
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: action, ResourceType: "file", ResourceID: id, RequestID: a.RequestID, Metadata: meta})
}

// ---------- Vistas ----------
type FileView struct {
	ID       uuid.UUID `json:"id"`
	Kind     string    `json:"kind"`
	Mime     string    `json:"mime_type"`
	Size     int64     `json:"size_bytes"`
	Width    *int32    `json:"width,omitempty"`
	Height   *int32    `json:"height,omitempty"`
	URL      string    `json:"url"`
	ThumbURL string    `json:"thumb_url,omitempty"`
}

func fileView(f db.FileObject) FileView {
	v := FileView{ID: f.ID, Kind: f.Kind, Mime: f.MimeType, Size: f.SizeBytes, URL: "/api/v1/files/" + f.ID.String()}
	if f.Width.Valid {
		w := f.Width.Int32
		v.Width = &w
	}
	if f.Height.Valid {
		h := f.Height.Int32
		v.Height = &h
	}
	if f.ThumbKey.Valid {
		v.ThumbURL = v.URL + "?thumb=1"
	}
	return v
}

// ---------- Imágenes (§18.3) ----------
const (
	maxPixels = 50_000_000
	maxWidth  = 1920
	maxHeight = 1080
	thumbW    = 320
	thumbH    = 240
	jpegMain  = 82
	jpegThumb = 75
)

func isHEIC(data []byte) bool {
	if len(data) < 12 || string(data[4:8]) != "ftyp" {
		return false
	}
	switch string(data[8:12]) {
	case "heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "heif":
		return true
	}
	return false
}

type processed struct {
	main, thumb []byte
	w, h        int
}

// processImage valida el formato real (no el nombre), rechaza archivos corruptos o desproporcionados, reduce a
// 1920×1080 conservando proporción, comprime y genera miniatura.
//
// Nota: la conversión a WebP requiere una biblioteca con cgo que aún no se incorpora; se guarda JPEG optimizado.
// HEIC tampoco se decodifica todavía en el servidor.
func processImage(data []byte) (processed, error) {
	if isHEIC(data) {
		return processed{}, ValidationError{"file": "los archivos HEIC aún no se convierten en el servidor; expórtalo como JPG, PNG o WebP"}
	}
	head := data
	if len(head) > 512 {
		head = head[:512]
	}
	var cfg image.Config
	var err error
	var decode func() (image.Image, error)
	switch http.DetectContentType(head) {
	case "image/jpeg", "image/png":
		if cfg, _, err = image.DecodeConfig(bytes.NewReader(data)); err != nil {
			return processed{}, ValidationError{"file": "el archivo está dañado o no es una imagen válida"}
		}
		decode = func() (image.Image, error) {
			return imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
		}
	case "image/webp":
		if cfg, err = webp.DecodeConfig(bytes.NewReader(data)); err != nil {
			return processed{}, ValidationError{"file": "el archivo está dañado o no es una imagen válida"}
		}
		decode = func() (image.Image, error) { return webp.Decode(bytes.NewReader(data)) }
	default:
		return processed{}, ValidationError{"file": "formato no admitido: usa JPG, PNG o WebP"}
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxPixels {
		return processed{}, ValidationError{"file": "las dimensiones de la imagen no son válidas"}
	}
	img, err := decode()
	if err != nil {
		return processed{}, ValidationError{"file": "el archivo está dañado o no es una imagen válida"}
	}
	if b := img.Bounds(); b.Dx() > maxWidth || b.Dy() > maxHeight {
		img = imaging.Fit(img, maxWidth, maxHeight, imaging.Lanczos)
	}
	// JPEG no tiene transparencia: se compone sobre blanco.
	flat := imaging.New(img.Bounds().Dx(), img.Bounds().Dy(), color.White)
	flat = imaging.Overlay(flat, img, image.Pt(0, 0), 1)
	var main, thumb bytes.Buffer
	if err := imaging.Encode(&main, flat, imaging.JPEG, imaging.JPEGQuality(jpegMain)); err != nil {
		return processed{}, err
	}
	if err := imaging.Encode(&thumb, imaging.Fit(flat, thumbW, thumbH, imaging.Linear), imaging.JPEG, imaging.JPEGQuality(jpegThumb)); err != nil {
		return processed{}, err
	}
	return processed{main: main.Bytes(), thumb: thumb.Bytes(), w: flat.Bounds().Dx(), h: flat.Bounds().Dy()}, nil
}

func sum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func key(kind string, owner *uuid.UUID, ext string) string {
	o := "shared"
	if owner != nil {
		o = owner.String()
	}
	now := time.Now().UTC()
	// Organizado por tipo, paciente y fecha, sin depender de nombres del usuario (§18.1).
	return fmt.Sprintf("%s/%s/%04d/%02d/%s%s", kind, o, now.Year(), int(now.Month()), uuid.NewString(), ext)
}

func (s *Service) checkQuota(ctx context.Context, owner *uuid.UUID, add int64) error {
	if owner == nil {
		return nil
	}
	p, err := s.patients.Get(ctx, *owner)
	if err != nil {
		return ErrNotFound
	}
	cfg, err := s.settings.Storage(ctx)
	if err != nil {
		return err
	}
	quota := cfg.DefaultQuotaBytes
	if p.QuotaOverrideBytes.Valid {
		quota = p.QuotaOverrideBytes.Int64
	}
	used, err := s.q.PatientStorageUsed(ctx, uuid.NullUUID{UUID: *owner, Valid: true})
	if err != nil {
		return err
	}
	if used+add > quota {
		return ErrQuotaExceeded
	}
	return nil
}

// UploadImage procesa y guarda una imagen. Fotografías clínicas y de seguimiento son SIEMPRE privadas (§18.3).
func (s *Service) UploadImage(ctx context.Context, a Actor, kind string, owner *uuid.UUID, data []byte) (FileView, error) {
	visibility := "public"
	switch kind {
	case "tracking_photo":
		visibility = "private"
		if owner == nil {
			return FileView{}, ValidationError{"owner": "las fotografías de seguimiento pertenecen a un paciente"}
		}
	case "dish_image", "brand_logo", "brand_photo":
	default:
		return FileView{}, ValidationError{"kind": "tipo de imagen no válido"}
	}
	cfg, err := s.settings.Storage(ctx)
	if err != nil {
		return FileView{}, err
	}
	if int64(len(data)) > cfg.MaxImageBytes {
		return FileView{}, ErrTooLarge
	}
	pr, err := processImage(data)
	if err != nil {
		return FileView{}, err
	}
	total := int64(len(pr.main) + len(pr.thumb))
	if err := s.checkQuota(ctx, owner, total); err != nil {
		return FileView{}, err
	}
	k, tk := key(kind, owner, ".jpg"), key(kind+"_thumb", owner, ".jpg")
	b := s.bucket(visibility)
	if err := s.store.Put(ctx, b, k, pr.main, "image/jpeg"); err != nil {
		return FileView{}, err
	}
	if err := s.store.Put(ctx, b, tk, pr.thumb, "image/jpeg"); err != nil {
		_ = s.store.Delete(ctx, b, k)
		return FileView{}, err
	}
	f, err := s.q.InsertFile(ctx, db.InsertFileParams{
		StorageKey: k, ThumbKey: pgtype.Text{String: tk, Valid: true}, Kind: kind, Visibility: visibility, MimeType: "image/jpeg", SizeBytes: total,
		Width: pgtype.Int4{Int32: int32(pr.w), Valid: true}, Height: pgtype.Int4{Int32: int32(pr.h), Valid: true}, Checksum: sum(pr.main),
		OwnerPatientID: nullUUID(owner), CreatedBy: uuid.NullUUID{UUID: a.ID, Valid: a.ID != uuid.Nil},
	})
	if err != nil {
		_ = s.store.Delete(ctx, b, k)
		_ = s.store.Delete(ctx, b, tk)
		return FileView{}, err
	}
	s.rec(ctx, a, "file.upload", f.ID, map[string]any{"kind": kind, "bytes": total})
	return fileView(f), nil
}

func nullUUID(id *uuid.UUID) uuid.NullUUID {
	if id == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *id, Valid: true}
}

// ---------- PDF (§18.4) ----------
var activePDFTokens = []string{"/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/RichMedia"}

// scanPDF valida el tipo REAL y rechaza PDF con elementos activos. Es una revisión básica: no sustituye a un
// antivirus (ClamAV queda como mejora para producción, §18.4).
func scanPDF(data []byte) error {
	if !bytes.HasPrefix(data, []byte("%PDF-")) {
		return ValidationError{"file": "el archivo no es un PDF válido"}
	}
	tail := data
	if len(tail) > 2048 {
		tail = tail[len(tail)-2048:]
	}
	if !bytes.Contains(tail, []byte("%%EOF")) {
		return ValidationError{"file": "el PDF está incompleto o dañado"}
	}
	for _, t := range activePDFTokens {
		if bytes.Contains(data, []byte(t)) {
			return ValidationError{"file": "el PDF contiene elementos activos (JavaScript o archivos incrustados) y no se acepta"}
		}
	}
	return nil
}

// ---------- Documentos clínicos ----------
type DocumentInput struct {
	Name, Category, Description string
	DocumentDate                time.Time
	Visible                     bool
}

type DocumentView struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Category    string    `json:"category"`
	Description string    `json:"description"`
	Date        string    `json:"document_date"`
	Visible     bool      `json:"visible_to_patient"`
	ScanStatus  string    `json:"scan_status"`
	Size        int64     `json:"size_bytes"`
	UploadedAt  time.Time `json:"uploaded_at"`
	FileID      uuid.UUID `json:"file_id"`
	URL         string    `json:"url"`
}

var categories = map[string]bool{"laboratorio": true, "estudio": true, "receta": true, "consentimiento": true, "otro": true}

func (in DocumentInput) validate() ValidationError {
	errs := ValidationError{}
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 200 {
		errs["name"] = "el nombre es obligatorio (máx. 200 caracteres)"
	}
	if !categories[in.Category] {
		errs["category"] = "categoría no válida"
	}
	if len(in.Description) > 1000 {
		errs["description"] = "máximo 1000 caracteres"
	}
	if in.DocumentDate.IsZero() || in.DocumentDate.After(time.Now().Add(24*time.Hour)) {
		errs["document_date"] = "indica una fecha válida (no futura)"
	}
	return errs
}

func (s *Service) requireConsent(ctx context.Context, patient uuid.UUID) error {
	if _, err := s.patients.Get(ctx, patient); err != nil {
		return ErrNotFound
	}
	ok, err := s.patients.ConsentComplete(ctx, patient)
	if err != nil {
		return err
	}
	if !ok {
		return ErrConsentPending
	}
	return nil
}

func docView(d db.PatientDocument, size int64) DocumentView {
	return DocumentView{ID: d.ID, Name: d.Name, Category: d.Category, Description: d.Description, Date: d.DocumentDate.Time.Format("2006-01-02"), Visible: d.VisibleToPatient,
		ScanStatus: d.ScanStatus, Size: size, UploadedAt: d.UploadedAt.Time, FileID: d.FileObjectID, URL: "/api/v1/files/" + d.FileObjectID.String()}
}

// AddDocument guarda un PDF en el expediente (requiere consentimientos completos y cuota disponible).
func (s *Service) AddDocument(ctx context.Context, a Actor, patient uuid.UUID, in DocumentInput, data []byte) (DocumentView, error) {
	if err := s.requireConsent(ctx, patient); err != nil {
		return DocumentView{}, err
	}
	if errs := in.validate(); len(errs) > 0 {
		return DocumentView{}, errs
	}
	cfg, err := s.settings.Storage(ctx)
	if err != nil {
		return DocumentView{}, err
	}
	if int64(len(data)) > cfg.MaxPdfBytes {
		return DocumentView{}, ErrTooLarge
	}
	if err := scanPDF(data); err != nil {
		return DocumentView{}, err
	}
	if err := s.checkQuota(ctx, &patient, int64(len(data))); err != nil {
		return DocumentView{}, err
	}
	k := key("document", &patient, ".pdf")
	if err := s.store.Put(ctx, s.private, k, data, "application/pdf"); err != nil {
		return DocumentView{}, err
	}
	f, err := s.q.InsertFile(ctx, db.InsertFileParams{StorageKey: k, Kind: "document", Visibility: "private", MimeType: "application/pdf", SizeBytes: int64(len(data)),
		Checksum: sum(data), OwnerPatientID: uuid.NullUUID{UUID: patient, Valid: true}, CreatedBy: uuid.NullUUID{UUID: a.ID, Valid: true}})
	if err != nil {
		_ = s.store.Delete(ctx, s.private, k)
		return DocumentView{}, err
	}
	d, err := s.q.InsertDocument(ctx, db.InsertDocumentParams{PatientID: patient, FileObjectID: f.ID, Name: strings.TrimSpace(in.Name), Category: in.Category, Description: in.Description,
		DocumentDate: pgtype.Date{Time: in.DocumentDate, Valid: true}, VisibleToPatient: in.Visible, ScanStatus: "clean", UploadedBy: a.ID})
	if err != nil {
		return DocumentView{}, err
	}
	s.rec(ctx, a, "document.upload", d.ID, map[string]any{"patient": patient, "bytes": len(data)})
	return docView(d, f.SizeBytes), nil
}

func (s *Service) ListDocuments(ctx context.Context, patient uuid.UUID, onlyVisible bool) ([]DocumentView, error) {
	rows, err := s.q.ListDocuments(ctx, db.ListDocumentsParams{PatientID: patient, OnlyVisible: onlyVisible})
	if err != nil {
		return nil, err
	}
	out := []DocumentView{}
	for _, r := range rows {
		out = append(out, DocumentView{ID: r.ID, Name: r.Name, Category: r.Category, Description: r.Description, Date: r.DocumentDate.Time.Format("2006-01-02"), Visible: r.VisibleToPatient,
			ScanStatus: r.ScanStatus, Size: r.SizeBytes, UploadedAt: r.UploadedAt.Time, FileID: r.FileObjectID, URL: "/api/v1/files/" + r.FileObjectID.String()})
	}
	return out, nil
}

func (s *Service) UpdateDocument(ctx context.Context, a Actor, patient, id uuid.UUID, in DocumentInput) (DocumentView, error) {
	if errs := in.validate(); len(errs) > 0 {
		return DocumentView{}, errs
	}
	d, err := s.q.UpdateDocument(ctx, db.UpdateDocumentParams{ID: id, PatientID: patient, Name: strings.TrimSpace(in.Name), Category: in.Category, Description: in.Description,
		DocumentDate: pgtype.Date{Time: in.DocumentDate, Valid: true}, VisibleToPatient: in.Visible})
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentView{}, ErrNotFound
	}
	if err != nil {
		return DocumentView{}, err
	}
	s.rec(ctx, a, "document.update", d.ID, map[string]any{"visible": d.VisibleToPatient})
	return docView(d, 0), nil
}

// DeleteDocument es lógico: el archivo deja de ser accesible pero queda trazabilidad (§17.2).
func (s *Service) DeleteDocument(ctx context.Context, a Actor, patient, id uuid.UUID) error {
	fid, err := s.q.SoftDeleteDocument(ctx, db.SoftDeleteDocumentParams{ID: id, PatientID: patient})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := s.q.SoftDeleteFile(ctx, fid); err != nil {
		return err
	}
	s.rec(ctx, a, "document.delete", id, nil)
	return nil
}

// ---------- Cuotas (§18.2) ----------
type Usage struct {
	UsedBytes  int64 `json:"used_bytes"`
	QuotaBytes int64 `json:"quota_bytes"`
	Pct        int   `json:"pct"`
	Warn       bool  `json:"warn"`
}

func (s *Service) Usage(ctx context.Context, patient uuid.UUID) (Usage, error) {
	p, err := s.patients.Get(ctx, patient)
	if err != nil {
		return Usage{}, ErrNotFound
	}
	cfg, err := s.settings.Storage(ctx)
	if err != nil {
		return Usage{}, err
	}
	quota := cfg.DefaultQuotaBytes
	if p.QuotaOverrideBytes.Valid {
		quota = p.QuotaOverrideBytes.Int64
	}
	used, err := s.q.PatientStorageUsed(ctx, uuid.NullUUID{UUID: patient, Valid: true})
	if err != nil {
		return Usage{}, err
	}
	pct := int(used * 100 / quota)
	if pct > 100 {
		pct = 100
	}
	return Usage{UsedBytes: used, QuotaBytes: quota, Pct: pct, Warn: pct >= cfg.WarnThresholdPct}, nil
}

// ---------- Descarga autorizada (§4.2) ----------
type Principal struct {
	UserID    uuid.UUID
	Role      string // nutritionist | patient
	PatientID uuid.UUID
}

// Open autoriza y abre un archivo. La ruta física nunca se expone. Si no está autorizado se responde "no
// encontrado" para no revelar la existencia del archivo.
func (s *Service) Open(ctx context.Context, p Principal, id uuid.UUID, thumb bool) (db.FileObject, io.ReadCloser, error) {
	f, err := s.q.GetFile(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.FileObject{}, nil, ErrNotFound
	}
	if err != nil {
		return db.FileObject{}, nil, err
	}
	allowed, err := s.authorize(ctx, p, f)
	if err != nil {
		return db.FileObject{}, nil, err
	}
	if !allowed {
		return db.FileObject{}, nil, ErrNotFound
	}
	k := f.StorageKey
	if thumb && f.ThumbKey.Valid {
		k = f.ThumbKey.String
	}
	rc, err := s.store.Get(ctx, s.bucket(f.Visibility), k)
	if err != nil {
		return db.FileObject{}, nil, err
	}
	return f, rc, nil
}

func (s *Service) authorize(ctx context.Context, p Principal, f db.FileObject) (bool, error) {
	if p.Role == "nutritionist" {
		return true, nil
	}
	if f.Visibility == "public" {
		return true, nil // recursos públicos controlados: cualquier sesión válida
	}
	if p.Role != "patient" || p.PatientID == uuid.Nil || !f.OwnerPatientID.Valid || f.OwnerPatientID.UUID != p.PatientID {
		return false, nil
	}
	switch f.Kind {
	case "document":
		d, err := s.q.DocumentAccessByFile(ctx, f.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return err == nil && d.VisibleToPatient && d.ScanStatus == "clean", err
	case "tracking_photo":
		owner, err := s.q.TrackingPhotoOwner(ctx, f.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return err == nil && owner == p.PatientID, err
	}
	return false, nil
}
