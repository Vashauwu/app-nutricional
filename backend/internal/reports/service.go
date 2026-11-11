// Package reports genera exportaciones (CSV, Excel) y reportes en PDF (MVP_SPEC §15). Toda exportación de datos
// personales queda en la bitácora de auditoría.
package reports

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jung-kurt/gofpdf"
	"github.com/xuri/excelize/v2"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/audit"
	"github.com/nutri/app-nutricional/backend/internal/tracking"
)

var ErrNotFound = errors.New("no encontrado")

type ValidationError map[string]string

func (v ValidationError) Error() string { return "datos inválidos" }

type Actor struct {
	ID        uuid.UUID
	RequestID string
}

type Patients interface {
	Get(ctx context.Context, id uuid.UUID) (db.Patient, error)
	Measurements(ctx context.Context, patient uuid.UUID) ([]db.PatientMeasurement, error)
}

type Service struct {
	q        *db.Queries
	patients Patients
	tracking *tracking.Service
	audit    audit.Recorder
	log      *slog.Logger
	now      func() time.Time
}

func NewService(pool db.DBTX, p Patients, t *tracking.Service, log *slog.Logger) *Service {
	q := db.New(pool)
	return &Service{q: q, patients: p, tracking: t, audit: audit.Recorder{Q: q, Log: log}, log: log, now: time.Now}
}

// Table es un conjunto tabular neutro que se serializa a CSV o Excel.
type Table struct {
	Name    string
	Headers []string
	Rows    [][]string
}

// maxRows protege al servidor de exportaciones desproporcionadas.
const maxRows = 20000

func (s *Service) rec(ctx context.Context, a Actor, action string, resource uuid.UUID, meta map[string]any) {
	s.audit.Record(ctx, audit.Event{Actor: a.ID, Action: action, ResourceType: "export", ResourceID: resource, RequestID: a.RequestID, Metadata: meta})
}

func fmtDate(t time.Time) string { return t.Format("2006-01-02") }

// ---------- Conjuntos de datos ----------
func (s *Service) PatientsTable(ctx context.Context) (Table, error) {
	t := Table{Name: "Pacientes", Headers: []string{"Nombre", "Apellidos", "Correo", "Teléfono", "Nacimiento", "Sexo", "Objetivo", "Estado", "Alta"}}
	for off := int32(0); len(t.Rows) < maxRows; off += 500 {
		rows, err := s.q.ListPatients(ctx, db.ListPatientsParams{PageLimit: 500, PageOffset: off})
		if err != nil {
			return Table{}, err
		}
		for _, p := range rows {
			t.Rows = append(t.Rows, []string{p.FirstName, p.LastName, p.Email, p.Phone, fmtDate(p.BirthDate.Time), p.Sex, p.Goal, p.Status, fmtDate(p.CreatedAt.Time)})
		}
		if len(rows) < 500 {
			break
		}
	}
	return t, nil
}

func (s *Service) MeasurementsTable(ctx context.Context, patient uuid.UUID) (Table, error) {
	if _, err := s.patients.Get(ctx, patient); err != nil {
		return Table{}, ErrNotFound
	}
	ms, err := s.patients.Measurements(ctx, patient)
	if err != nil {
		return Table{}, err
	}
	t := Table{Name: "Mediciones", Headers: []string{"Fecha", "Peso (kg)", "Estatura (cm)", "IMC", "Cintura (cm)", "Cadera (cm)", "Grasa (%)", "Notas"}}
	for _, m := range ms {
		opt := func(d interface{ String() string }, ok bool) string {
			if !ok {
				return ""
			}
			return d.String()
		}
		t.Rows = append(t.Rows, []string{fmtDate(m.MeasuredAt.Time), m.WeightKg.String(), m.HeightCm.String(), m.Bmi.String(),
			opt(m.WaistCm.Decimal, m.WaistCm.Valid), opt(m.HipCm.Decimal, m.HipCm.Valid), opt(m.BodyFatPct.Decimal, m.BodyFatPct.Valid), m.Notes})
	}
	return t, nil
}

func (s *Service) TrackingTable(ctx context.Context, patient uuid.UUID, from, to *time.Time) (Table, error) {
	if _, err := s.patients.Get(ctx, patient); err != nil {
		return Table{}, ErrNotFound
	}
	pg, err := s.tracking.Feed(ctx, tracking.FeedQuery{PatientID: &patient, From: from, To: to, Page: 1, PageSize: 100})
	if err != nil {
		return Table{}, err
	}
	t := Table{Name: "Seguimiento", Headers: []string{"Fecha", "Tiempo de comida", "Platillo", "Versión", "Estado", "Comentario de la paciente", "Fotografías", "Mensajes"}}
	status := map[string]string{"done": "Realizada", "skipped": "Omitida"}
	for page := 1; ; page++ {
		for _, e := range pg.Items {
			t.Rows = append(t.Rows, []string{e.Date, e.SlotName, e.DishName, fmt.Sprint(e.DishVersion), status[e.Status], e.PatientComment, fmt.Sprint(len(e.Photos)), fmt.Sprint(len(e.Thread))})
		}
		if page*pg.PageSize >= pg.Total || len(t.Rows) >= maxRows {
			break
		}
		if pg, err = s.tracking.Feed(ctx, tracking.FeedQuery{PatientID: &patient, From: from, To: to, Page: page + 1, PageSize: 100}); err != nil {
			return Table{}, err
		}
	}
	return t, nil
}

// ---------- Serialización ----------

// safe neutraliza celdas que Excel interpretaría como fórmula (inyección CSV).
func safe(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		// Los números negativos legítimos no se alteran.
		if v[0] == '-' || v[0] == '+' {
			if _, err := strconv.ParseFloat(v, 64); err == nil {
				return v
			}
		}
		return "'" + v
	}
	return v
}

func (t Table) CSV() ([]byte, error) {
	var b bytes.Buffer
	b.Write([]byte{0xEF, 0xBB, 0xBF}) // BOM: Excel abre los acentos correctamente
	w := csv.NewWriter(&b)
	hdr := make([]string, len(t.Headers))
	copy(hdr, t.Headers)
	if err := w.Write(hdr); err != nil {
		return nil, err
	}
	for _, r := range t.Rows {
		row := make([]string, len(r))
		for i, c := range r {
			row[i] = safe(c)
		}
		if err := w.Write(row); err != nil {
			return nil, err
		}
	}
	w.Flush()
	return b.Bytes(), w.Error()
}

func (t Table) XLSX() ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()
	sheet := t.Name
	if err := f.SetSheetName("Sheet1", sheet); err != nil {
		return nil, err
	}
	bold, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	for i, h := range t.Headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellValue(sheet, cell, h)
		_ = f.SetCellStyle(sheet, cell, cell, bold)
		col, _ := excelize.ColumnNumberToName(i + 1)
		_ = f.SetColWidth(sheet, col, col, 18)
	}
	for r, row := range t.Rows {
		for c, v := range row {
			cell, _ := excelize.CoordinatesToCellName(c+1, r+2)
			_ = f.SetCellStr(sheet, cell, safe(v)) // siempre texto: nunca se evalúa como fórmula
		}
	}
	var b bytes.Buffer
	if err := f.Write(&b); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// Export serializa y registra la exportación en auditoría.
func (s *Service) Export(ctx context.Context, a Actor, t Table, format string, resource uuid.UUID, kind string) ([]byte, string, error) {
	var data []byte
	var mime string
	var err error
	switch format {
	case "csv":
		data, err = t.CSV()
		mime = "text/csv; charset=utf-8"
	case "xlsx":
		data, err = t.XLSX()
		mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	default:
		return nil, "", ValidationError{"format": "usa csv o xlsx"}
	}
	if err != nil {
		return nil, "", err
	}
	s.rec(ctx, a, "export."+kind, resource, map[string]any{"format": format, "rows": len(t.Rows)})
	return data, mime, nil
}

// ---------- PDF ----------

// SummaryPDF genera el reporte de seguimiento de un paciente: datos básicos, última medición y cumplimiento.
func (s *Service) SummaryPDF(ctx context.Context, a Actor, patient uuid.UUID, from, to *time.Time, clinic string) ([]byte, error) {
	p, err := s.patients.Get(ctx, patient)
	if err != nil {
		return nil, ErrNotFound
	}
	comp, err := s.tracking.Compliance(ctx, patient, from, to)
	if err != nil {
		return nil, err
	}
	ms, err := s.patients.Measurements(ctx, patient)
	if err != nil {
		return nil, err
	}

	pdf := gofpdf.New("P", "mm", "A4", "")
	tr := pdf.UnicodeTranslatorFromDescriptor("")
	pdf.SetTitle(tr("Reporte de seguimiento"), true)
	pdf.SetMargins(18, 18, 18)
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 18)
	pdf.CellFormat(0, 10, tr("Reporte de seguimiento"), "", 1, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 10)
	pdf.SetTextColor(90, 90, 90)
	pdf.CellFormat(0, 6, tr(clinic), "", 1, "L", false, 0, "")
	pdf.CellFormat(0, 6, tr("Generado el "+s.now().Format("02/01/2006")), "", 1, "L", false, 0, "")
	pdf.SetTextColor(0, 0, 0)
	pdf.Ln(4)

	h := func(t string) {
		pdf.SetFont("Helvetica", "B", 12)
		pdf.CellFormat(0, 8, tr(t), "B", 1, "L", false, 0, "")
		pdf.Ln(1)
		pdf.SetFont("Helvetica", "", 10)
	}
	row := func(k, v string) {
		pdf.SetFont("Helvetica", "B", 10)
		pdf.CellFormat(55, 6, tr(k), "", 0, "L", false, 0, "")
		pdf.SetFont("Helvetica", "", 10)
		pdf.CellFormat(0, 6, tr(v), "", 1, "L", false, 0, "")
	}

	h("Paciente")
	row("Nombre", p.FirstName+" "+p.LastName)
	row("Objetivo", p.Goal)
	pdf.Ln(3)

	h("Última medición")
	if len(ms) == 0 {
		row("Mediciones", "Sin registros")
	} else {
		m := ms[0]
		row("Fecha", fmtDate(m.MeasuredAt.Time))
		row("Peso", m.WeightKg.String()+" kg")
		row("Estatura", m.HeightCm.String()+" cm")
		row("IMC", m.Bmi.String())
		if m.WaistCm.Valid {
			row("Cintura", m.WaistCm.Decimal.String()+" cm")
		}
		if len(ms) > 1 {
			first := ms[len(ms)-1]
			row("Cambio de peso", m.WeightKg.Sub(first.WeightKg).String()+" kg desde "+fmtDate(first.MeasuredAt.Time))
		}
	}
	pdf.Ln(3)

	h(fmt.Sprintf("Cumplimiento (%s a %s)", comp.From, comp.To))
	if comp.Pct == nil {
		row("Cumplimiento", "Sin comidas programadas en el periodo")
	} else {
		row("Cumplimiento", fmt.Sprintf("%d %%", *comp.Pct))
	}
	row("Programadas", fmt.Sprint(comp.Planned))
	row("Realizadas", fmt.Sprint(comp.Done))
	row("Omitidas", fmt.Sprint(comp.Skipped))
	row("Sin registro", fmt.Sprint(comp.Pending))
	pdf.Ln(2)
	pdf.SetFont("Helvetica", "B", 9)
	pdf.CellFormat(40, 6, "Fecha", "B", 0, "L", false, 0, "")
	pdf.CellFormat(35, 6, "Realizadas", "B", 0, "R", false, 0, "")
	pdf.CellFormat(35, 6, "Programadas", "B", 0, "R", false, 0, "")
	pdf.CellFormat(30, 6, "%", "B", 1, "R", false, 0, "")
	pdf.SetFont("Helvetica", "", 9)
	for _, d := range comp.Days {
		pc := "—"
		if d.Pct != nil {
			pc = fmt.Sprintf("%d %%", *d.Pct)
		}
		pdf.CellFormat(40, 6, d.Date, "", 0, "L", false, 0, "")
		pdf.CellFormat(35, 6, fmt.Sprint(d.Done), "", 0, "R", false, 0, "")
		pdf.CellFormat(35, 6, fmt.Sprint(d.Planned), "", 0, "R", false, 0, "")
		pdf.CellFormat(30, 6, tr(pc), "", 1, "R", false, 0, "")
	}
	pdf.Ln(6)
	pdf.SetFont("Helvetica", "I", 8)
	pdf.SetTextColor(110, 110, 110)
	pdf.MultiCell(0, 4, tr("El cumplimiento se calcula como comidas realizadas entre comidas programadas hasta hoy; las omitidas y las sin registro no suman. Este reporte apoya la revisión profesional y no sustituye su criterio."), "", "L", false)

	var b bytes.Buffer
	if err := pdf.Output(&b); err != nil {
		return nil, err
	}
	s.rec(ctx, a, "export.summary_pdf", patient, map[string]any{"from": comp.From, "to": comp.To})
	return b.Bytes(), nil
}
