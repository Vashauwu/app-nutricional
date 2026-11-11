package patients

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/generated/db"
)

// ---------- Laboratorios (química sanguínea) ----------
// La nutrióloga captura los valores; cada resultado trae su propio rango de referencia (cambia entre laboratorios y por sexo).
// El PDF original se guarda aparte, en Documentos (categoría «laboratorio»).

type LabResultInput struct {
	Name, Unit     string
	Value          decimal.Decimal
	RefMin, RefMax *decimal.Decimal
}

type LabInput struct {
	TakenAt time.Time
	LabName string
	Notes   string
	Results []LabResultInput
}

type LabResultView struct {
	Name   string              `json:"name"`
	Value  decimal.Decimal     `json:"value"`
	Unit   string              `json:"unit"`
	RefMin decimal.NullDecimal `json:"ref_min"`
	RefMax decimal.NullDecimal `json:"ref_max"`
}

type LabReportView struct {
	ID      uuid.UUID       `json:"id"`
	TakenAt string          `json:"taken_at"`
	LabName string          `json:"lab_name"`
	Notes   string          `json:"notes"`
	Results []LabResultView `json:"results"`
}

const maxLabResults = 80

func (s *Service) AddLabReport(ctx context.Context, a Actor, patient uuid.UUID, in LabInput) (LabReportView, error) {
	errs := ValidationError{}
	lab := clean(in.LabName, 150, "lab_name", false, errs)
	notes := clean(in.Notes, 1000, "notes", false, errs)
	if in.TakenAt.After(s.now().Add(24 * time.Hour)) {
		errs["taken_at"] = "la fecha no puede ser futura"
	}
	if len(in.Results) == 0 {
		errs["results"] = "agrega al menos un resultado"
	}
	if len(in.Results) > maxLabResults {
		errs["results"] = "máximo 80 resultados por estudio"
	}
	seen := map[string]bool{}
	for i, r := range in.Results {
		key := func(f string) string { return "results." + strconv.Itoa(i) + "." + f }
		name := clean(r.Name, 120, key("name"), true, errs)
		clean(r.Unit, 30, key("unit"), false, errs)
		if seen[name] {
			errs[key("name")] = "este análisis está repetido"
		}
		seen[name] = true
		if r.RefMin != nil && r.RefMax != nil && r.RefMin.GreaterThan(*r.RefMax) {
			errs[key("ref_min")] = "el mínimo no puede ser mayor que el máximo"
		}
		if r.Value.IsNegative() {
			errs[key("value")] = "no puede ser negativo"
		}
	}
	if len(errs) > 0 {
		return LabReportView{}, errs
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return LabReportView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	rep, err := q.InsertLabReport(ctx, db.InsertLabReportParams{PatientID: patient, TakenAt: pgDate(in.TakenAt), LabName: lab, Notes: notes, CreatedBy: a.ID})
	if err != nil {
		return LabReportView{}, err
	}
	out := LabReportView{ID: rep.ID, TakenAt: in.TakenAt.Format("2006-01-02"), LabName: lab, Notes: notes, Results: []LabResultView{}}
	for i, r := range in.Results {
		row, err := q.InsertLabResult(ctx, db.InsertLabResultParams{ReportID: rep.ID, Name: strings.TrimSpace(r.Name), Value: r.Value, Unit: strings.TrimSpace(r.Unit), RefMin: nd(r.RefMin), RefMax: nd(r.RefMax), Position: int32(i)})
		if err != nil {
			return LabReportView{}, err
		}
		out.Results = append(out.Results, LabResultView{Name: row.Name, Value: row.Value, Unit: row.Unit, RefMin: row.RefMin, RefMax: row.RefMax})
	}
	if err := tx.Commit(ctx); err != nil {
		return LabReportView{}, err
	}
	s.rec(ctx, a, "lab.create", patient, map[string]any{"report_id": rep.ID, "results": len(in.Results)})
	return out, nil
}

func (s *Service) LabReports(ctx context.Context, patient uuid.UUID) ([]LabReportView, error) {
	reps, err := s.q.ListLabReports(ctx, patient)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListLabResults(ctx, patient)
	if err != nil {
		return nil, err
	}
	by := map[uuid.UUID][]LabResultView{}
	for _, r := range rows {
		by[r.ReportID] = append(by[r.ReportID], LabResultView{Name: r.Name, Value: r.Value, Unit: r.Unit, RefMin: r.RefMin, RefMax: r.RefMax})
	}
	out := make([]LabReportView, 0, len(reps))
	for _, r := range reps {
		res := by[r.ID]
		if res == nil {
			res = []LabResultView{}
		}
		out = append(out, LabReportView{ID: r.ID, TakenAt: r.TakenAt.Time.Format("2006-01-02"), LabName: r.LabName, Notes: r.Notes, Results: res})
	}
	return out, nil
}

func (s *Service) DeleteLabReport(ctx context.Context, a Actor, patient, id uuid.UUID) error {
	return s.del(ctx, a, patient, id, "lab.delete", func() (int64, error) {
		return s.q.DeleteLabReport(ctx, db.DeleteLabReportParams{ID: id, PatientID: patient})
	})
}

// ---------- HTTP ----------
type labReq struct {
	TakenAt string `json:"taken_at"`
	LabName string `json:"lab_name"`
	Notes   string `json:"notes"`
	Results []struct {
		Name   string  `json:"name"`
		Value  string  `json:"value"`
		Unit   string  `json:"unit"`
		RefMin *string `json:"ref_min"`
		RefMax *string `json:"ref_max"`
	} `json:"results"`
}

func (ct *Controller) addLab(c *gin.Context) {
	var in labReq
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	errs := ValidationError{}
	at, ok := parseDate(in.TakenAt)
	if !ok {
		errs["taken_at"] = "usa el formato AAAA-MM-DD"
	}
	m := LabInput{TakenAt: at, LabName: in.LabName, Notes: in.Notes}
	for i, r := range in.Results {
		v, err := decimal.NewFromString(r.Value)
		if err != nil {
			errs["results."+strconv.Itoa(i)+".value"] = "escribe un número válido (con punto decimal)"
		}
		m.Results = append(m.Results, LabResultInput{Name: r.Name, Unit: r.Unit, Value: v,
			RefMin: optDec("results."+strconv.Itoa(i)+".ref_min", r.RefMin, errs), RefMax: optDec("results."+strconv.Itoa(i)+".ref_max", r.RefMax, errs)})
	}
	if len(errs) > 0 {
		bad(c, errs)
		return
	}
	out, err := ct.svc.AddLabReport(c.Request.Context(), actor(c), pid(c), m)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (ct *Controller) labs(c *gin.Context) {
	list, err := ct.svc.LabReports(c.Request.Context(), pid(c))
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": nz(list)})
}

func (ct *Controller) deleteLab(c *gin.Context) {
	id, err := uuid.Parse(c.Param("cid"))
	if err != nil {
		fail(c, ct.log, ErrNotFound)
		return
	}
	if err := ct.svc.DeleteLabReport(c.Request.Context(), actor(c), pid(c), id); err != nil {
		fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}
