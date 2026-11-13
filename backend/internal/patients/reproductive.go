package patients

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nutri/app-nutricional/backend/generated/db"
)

// ---------- Salud reproductiva ----------
// Solo la nutrióloga la captura y la consulta (rutas clínicas, tras el consentimiento); la paciente no la ve en su app.
// Aplica a pacientes con sexo F u «Otro». La menarca es un dato único; la última menstruación acumula historial.

const (
	minMenarche = 8
	maxMenarche = 20
	maxWeeks    = 42
	dayHours    = 24 * time.Hour
)

// Reproductive es lo que se captura de forma opcional al registrar a la paciente.
type Reproductive struct {
	MenarcheAge     *int
	MenarcheUnknown bool
	LastPeriod      *time.Time
	PregnancyWeeks  *int
}

func (r Reproductive) empty() bool {
	return r.MenarcheAge == nil && !r.MenarcheUnknown && r.LastPeriod == nil && r.PregnancyWeeks == nil
}

type PeriodView struct {
	ID             uuid.UUID `json:"id"`
	LastPeriodDate string    `json:"last_period_date"`
	RecordedAt     time.Time `json:"recorded_at"`
}

type PregnancyView struct {
	ID           uuid.UUID `json:"id"`
	WeeksAtStart int       `json:"weeks_at_start"`
	RecordedOn   string    `json:"recorded_on"`
	DueDate      string    `json:"due_date"`
	CurrentWeeks int       `json:"current_weeks"`
	Notes        string    `json:"notes"`
	EndedOn      *string   `json:"ended_on"`
	Active       bool      `json:"active"`
}

type ReproductiveView struct {
	MenarcheAge     *int            `json:"menarche_age"`
	MenarcheUnknown bool            `json:"menarche_unknown"`
	Periods         []PeriodView    `json:"periods"`
	Pregnancy       *PregnancyView  `json:"pregnancy"`
	Pregnancies     []PregnancyView `json:"pregnancies"`
}

func dateStr(t pgtype.Date) string { return t.Time.Format("2006-01-02") }

// today es el día calendario del servicio (sin hora), para comparar con fechas sin zona.
func (s *Service) today() time.Time {
	n := s.now()
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
}

func (s *Service) pregnancyView(p db.PatientPregnancy) PregnancyView {
	v := PregnancyView{ID: p.ID, WeeksAtStart: int(p.WeeksAtStart), RecordedOn: dateStr(p.RecordedOn), DueDate: dateStr(p.DueDate), Notes: p.Notes, Active: !p.EndedOn.Valid}
	end := s.today()
	if p.EndedOn.Valid {
		e := dateStr(p.EndedOn)
		v.EndedOn = &e
		end = p.EndedOn.Time
	}
	w := int(p.WeeksAtStart) + int(end.Sub(p.RecordedOn.Time).Hours()/dayHours.Hours())/7
	if w > maxWeeks {
		w = maxWeeks
	}
	v.CurrentWeeks = w
	return v
}

// requireReproductive: la sección aplica a mujeres y a pacientes con sexo «Otro».
func requireReproductive(sex string) error {
	if sex == "M" {
		return ValidationError{"sex": "esta sección aplica solo a pacientes mujeres"}
	}
	return nil
}

func (s *Service) validateRepro(r Reproductive, birth time.Time) ValidationError {
	errs := ValidationError{}
	if r.MenarcheAge != nil && r.MenarcheUnknown {
		errs["menarche_age"] = "indica la edad o «no recuerda», no ambas"
	}
	if r.MenarcheAge != nil && (*r.MenarcheAge < minMenarche || *r.MenarcheAge > maxMenarche) {
		errs["menarche_age"] = "escribe una edad entre 8 y 20 años"
	}
	if r.LastPeriod != nil {
		switch {
		case r.LastPeriod.After(s.today().Add(dayHours)):
			errs["last_period_date"] = "la fecha no puede ser futura"
		case r.LastPeriod.Before(birth.AddDate(minMenarche, 0, 0)):
			errs["last_period_date"] = "la fecha es anterior a la edad posible de la menarca"
		}
	}
	if r.PregnancyWeeks != nil && (*r.PregnancyWeeks < 1 || *r.PregnancyWeeks > maxWeeks) {
		errs["pregnancy_weeks"] = "escribe las semanas de gestación (de 1 a 42)"
	}
	return errs
}

func dueDate(recorded time.Time, weeks int) time.Time {
	left := 40 - weeks
	if left < 0 {
		left = 0
	}
	return recorded.AddDate(0, 0, left*7)
}

// applyRepro guarda lo capturado dentro de la transacción de quien llama.
func (s *Service) applyRepro(ctx context.Context, q *db.Queries, a Actor, patient uuid.UUID, r Reproductive) error {
	if r.MenarcheAge != nil || r.MenarcheUnknown {
		age := pgtype.Int2{}
		if r.MenarcheAge != nil {
			age = pgtype.Int2{Int16: int16(*r.MenarcheAge), Valid: true}
		}
		if err := q.SetMenarche(ctx, db.SetMenarcheParams{ID: patient, MenarcheAge: age, MenarcheUnknown: r.MenarcheUnknown}); err != nil {
			return err
		}
	}
	if r.LastPeriod != nil {
		if _, err := q.InsertMenstrualRecord(ctx, db.InsertMenstrualRecordParams{PatientID: patient, LastPeriodDate: pgDate(*r.LastPeriod), CreatedBy: a.ID}); err != nil {
			return err
		}
	}
	if r.PregnancyWeeks != nil {
		today := s.today()
		if _, err := q.InsertPregnancy(ctx, db.InsertPregnancyParams{PatientID: patient, WeeksAtStart: int16(*r.PregnancyWeeks), RecordedOn: pgDate(today),
			DueDate: pgDate(dueDate(today, *r.PregnancyWeeks)), CreatedBy: a.ID}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Reproductive(ctx context.Context, id uuid.UUID) (ReproductiveView, error) {
	p, err := s.Get(ctx, id)
	if err != nil {
		return ReproductiveView{}, err
	}
	out := ReproductiveView{MenarcheUnknown: p.MenarcheUnknown, Periods: []PeriodView{}, Pregnancies: []PregnancyView{}}
	if p.MenarcheAge.Valid {
		v := int(p.MenarcheAge.Int16)
		out.MenarcheAge = &v
	}
	periods, err := s.q.ListMenstrualRecords(ctx, id)
	if err != nil {
		return out, err
	}
	for _, r := range periods {
		out.Periods = append(out.Periods, PeriodView{ID: r.ID, LastPeriodDate: dateStr(r.LastPeriodDate), RecordedAt: r.CreatedAt.Time})
	}
	preg, err := s.q.ListPregnancies(ctx, id)
	if err != nil {
		return out, err
	}
	for _, r := range preg {
		v := s.pregnancyView(r)
		if v.Active {
			cp := v
			out.Pregnancy = &cp
		}
		out.Pregnancies = append(out.Pregnancies, v)
	}
	return out, nil
}

func (s *Service) SetMenarche(ctx context.Context, a Actor, id uuid.UUID, age *int, unknown bool) error {
	p, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if err := requireReproductive(p.Sex); err != nil {
		return err
	}
	if errs := s.validateRepro(Reproductive{MenarcheAge: age, MenarcheUnknown: unknown}, p.BirthDate.Time); len(errs) > 0 {
		return errs
	}
	cur := pgtype.Int2{}
	if age != nil {
		cur = pgtype.Int2{Int16: int16(*age), Valid: true}
	}
	if err := s.q.SetMenarche(ctx, db.SetMenarcheParams{ID: id, MenarcheAge: cur, MenarcheUnknown: unknown}); err != nil {
		return err
	}
	s.rec(ctx, a, "reproductive.menarche", id, nil)
	return nil
}

func (s *Service) AddPeriod(ctx context.Context, a Actor, id uuid.UUID, date time.Time) (PeriodView, error) {
	p, err := s.Get(ctx, id)
	if err != nil {
		return PeriodView{}, err
	}
	if err := requireReproductive(p.Sex); err != nil {
		return PeriodView{}, err
	}
	if errs := s.validateRepro(Reproductive{LastPeriod: &date}, p.BirthDate.Time); len(errs) > 0 {
		return PeriodView{}, errs
	}
	r, err := s.q.InsertMenstrualRecord(ctx, db.InsertMenstrualRecordParams{PatientID: id, LastPeriodDate: pgDate(date), CreatedBy: a.ID})
	if err != nil {
		return PeriodView{}, err
	}
	s.rec(ctx, a, "reproductive.period_add", id, nil)
	return PeriodView{ID: r.ID, LastPeriodDate: dateStr(r.LastPeriodDate), RecordedAt: r.CreatedAt.Time}, nil
}

func (s *Service) AddPregnancy(ctx context.Context, a Actor, id uuid.UUID, weeks int, notes string) (PregnancyView, error) {
	p, err := s.Get(ctx, id)
	if err != nil {
		return PregnancyView{}, err
	}
	if err := requireReproductive(p.Sex); err != nil {
		return PregnancyView{}, err
	}
	errs := s.validateRepro(Reproductive{PregnancyWeeks: &weeks}, p.BirthDate.Time)
	notes = clean(notes, 500, "notes", false, errs)
	if len(errs) > 0 {
		return PregnancyView{}, errs
	}
	today := s.today()
	row, err := s.q.InsertPregnancy(ctx, db.InsertPregnancyParams{PatientID: id, WeeksAtStart: int16(weeks), RecordedOn: pgDate(today),
		DueDate: pgDate(dueDate(today, weeks)), Notes: notes, CreatedBy: a.ID})
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23505" {
			return PregnancyView{}, ValidationError{"pregnancy": "ya hay un embarazo vigente; finalízalo antes de registrar otro"}
		}
		return PregnancyView{}, err
	}
	s.rec(ctx, a, "reproductive.pregnancy_add", id, map[string]any{"weeks": weeks})
	return s.pregnancyView(row), nil
}

func (s *Service) EndPregnancy(ctx context.Context, a Actor, id, pregnancy uuid.UUID, ended *time.Time) error {
	day := s.today()
	if ended != nil {
		day = *ended
	}
	if day.After(s.today().Add(dayHours)) {
		return ValidationError{"ended_on": "la fecha no puede ser futura"}
	}
	n, err := s.q.EndPregnancy(ctx, db.EndPregnancyParams{ID: pregnancy, PatientID: id, EndedOn: pgDate(day)})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	s.rec(ctx, a, "reproductive.pregnancy_end", id, nil)
	return nil
}

// ---------- HTTP ----------
func optDay(field, v string, errs ValidationError) *time.Time {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	t, ok := parseDate(v)
	if !ok {
		errs[field] = "usa el formato AAAA-MM-DD"
		return nil
	}
	return &t
}

func (ct *Controller) reproductive(c *gin.Context) {
	v, err := ct.svc.Reproductive(c.Request.Context(), pid(c))
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (ct *Controller) setMenarche(c *gin.Context) {
	var in struct {
		Age     *int `json:"age"`
		Unknown bool `json:"unknown"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	if err := ct.svc.SetMenarche(c.Request.Context(), actor(c), pid(c), in.Age, in.Unknown); err != nil {
		fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) addPeriod(c *gin.Context) {
	var in struct {
		LastPeriodDate string `json:"last_period_date"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	errs := ValidationError{}
	d := optDay("last_period_date", in.LastPeriodDate, errs)
	if d == nil && len(errs) == 0 {
		errs["last_period_date"] = "este campo es obligatorio"
	}
	if len(errs) > 0 {
		bad(c, errs)
		return
	}
	out, err := ct.svc.AddPeriod(c.Request.Context(), actor(c), pid(c), *d)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (ct *Controller) addPregnancy(c *gin.Context) {
	var in struct {
		Weeks int    `json:"weeks"`
		Notes string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		bad(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	out, err := ct.svc.AddPregnancy(c.Request.Context(), actor(c), pid(c), in.Weeks, in.Notes)
	if err != nil {
		fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (ct *Controller) endPregnancy(c *gin.Context) {
	id, err := uuid.Parse(c.Param("cid"))
	if err != nil {
		fail(c, ct.log, ErrNotFound)
		return
	}
	var in struct {
		EndedOn string `json:"ended_on"`
	}
	_ = c.ShouldBindJSON(&in)
	errs := ValidationError{}
	d := optDay("ended_on", in.EndedOn, errs)
	if len(errs) > 0 {
		bad(c, errs)
		return
	}
	if err := ct.svc.EndPregnancy(c.Request.Context(), actor(c), pid(c), id, d); err != nil {
		fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}
