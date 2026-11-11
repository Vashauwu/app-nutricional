// Package dashboard arma el resumen del tablero de la nutrióloga (MVP_SPEC §13): pacientes, planes, cumplimiento,
// alertas y actividad reciente. Cada cifra enlaza al registro que la origina desde el cliente.
package dashboard

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/alerts"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/shared"
	"github.com/nutri/app-nutricional/backend/internal/tracking"
)

type Alerts interface {
	Published(ctx context.Context) (alerts.Summary, error)
}
type Tracking interface {
	Feed(ctx context.Context, q tracking.FeedQuery) (tracking.Page, error)
	Today() time.Time
}

type Service struct {
	q      *db.Queries
	alerts Alerts
	track  Tracking
}

func NewService(pool db.DBTX, a Alerts, t Tracking) *Service {
	return &Service{q: db.New(pool), alerts: a, track: t}
}

type PatientCounts struct {
	Total          int `json:"total"`
	Active         int `json:"active"`
	Invited        int `json:"invited"`
	ConsentPending int `json:"consent_pending"`
}

type EndingPlan struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	PatientID   uuid.UUID `json:"patient_id"`
	PatientName string    `json:"patient_name"`
	EndDate     string    `json:"end_date"`
}

type PlanCounts struct {
	Draft      int          `json:"draft"`
	Published  int          `json:"published"`
	Finished   int          `json:"finished"`
	Archived   int          `json:"archived"`
	EndingSoon []EndingPlan `json:"ending_soon"`
}

type PatientCompliance struct {
	PatientID   uuid.UUID `json:"patient_id"`
	PatientName string    `json:"patient_name"`
	Planned     int       `json:"planned"`
	Done        int       `json:"done"`
	Skipped     int       `json:"skipped"`
	Pct         *int      `json:"pct"`
}

type Compliance struct {
	Pct        *int                `json:"pct"`
	PerPatient []PatientCompliance `json:"per_patient"`
}

type View struct {
	Patients   PatientCounts        `json:"patients"`
	Plans      PlanCounts           `json:"plans"`
	Compliance Compliance           `json:"compliance"`
	Alerts     alerts.Summary       `json:"alerts"`
	Activity   []tracking.EntryView `json:"activity"`
	ToReview   int                  `json:"to_review"`
	From       string               `json:"from"`
	To         string               `json:"to"`
}

func pct(done, planned int) *int {
	if planned == 0 {
		return nil
	}
	v := (done*100 + planned/2) / planned
	return &v
}

func date(t time.Time) pgtype.Date { return pgtype.Date{Time: t, Valid: true} }

// Get calcula el tablero. Cumplimiento: últimos 7 días hasta hoy, en la zona horaria configurada.
func (s *Service) Get(ctx context.Context) (View, error) {
	today := s.track.Today()
	from := today.AddDate(0, 0, -6)
	v := View{From: from.Format("2006-01-02"), To: today.Format("2006-01-02")}

	pc, err := s.q.DashboardPatientCounts(ctx)
	if err != nil {
		return v, err
	}
	v.Patients = PatientCounts{Total: int(pc.Total), Active: int(pc.Active), Invited: int(pc.Invited), ConsentPending: int(pc.ConsentPending)}

	counts, err := s.q.DashboardPlanCounts(ctx)
	if err != nil {
		return v, err
	}
	for _, c := range counts {
		switch c.Status {
		case "draft":
			v.Plans.Draft = int(c.N)
		case "published":
			v.Plans.Published = int(c.N)
		case "finished":
			v.Plans.Finished = int(c.N)
		case "archived":
			v.Plans.Archived = int(c.N)
		}
	}
	ending, err := s.q.PlansEndingSoon(ctx, db.PlansEndingSoonParams{EndDate: date(today), EndDate_2: date(today.AddDate(0, 0, 3))})
	if err != nil {
		return v, err
	}
	v.Plans.EndingSoon = []EndingPlan{}
	for _, e := range ending {
		v.Plans.EndingSoon = append(v.Plans.EndingSoon, EndingPlan{ID: e.ID, Name: e.Name, PatientID: e.PatientID, PatientName: e.PatientName, EndDate: e.EndDate.Time.Format("2006-01-02")})
	}

	rows, err := s.q.ComplianceByPatient(ctx, db.ComplianceByPatientParams{PlanDate: date(from), PlanDate_2: date(today)})
	if err != nil {
		return v, err
	}
	v.Compliance.PerPatient = []PatientCompliance{}
	var planned, done int
	for _, r := range rows {
		planned += int(r.Planned)
		done += int(r.Done)
		v.Compliance.PerPatient = append(v.Compliance.PerPatient, PatientCompliance{PatientID: r.PatientID, PatientName: r.PatientName, Planned: int(r.Planned), Done: int(r.Done), Skipped: int(r.Skipped), Pct: pct(int(r.Done), int(r.Planned))})
	}
	v.Compliance.Pct = pct(done, planned)

	if v.Alerts, err = s.alerts.Published(ctx); err != nil {
		return v, err
	}
	feed, err := s.track.Feed(ctx, tracking.FeedQuery{Page: 1, PageSize: 8})
	if err != nil {
		return v, err
	}
	v.Activity = feed.Items
	if v.Activity == nil {
		v.Activity = []tracking.EntryView{}
	}
	v.ToReview = feed.Pending
	return v, nil
}

type Controller struct {
	svc  *Service
	auth *auth.Service
}

func NewController(svc *Service, a *auth.Service) *Controller { return &Controller{svc: svc, auth: a} }

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	v1.GET("/dashboard", auth.Authenticate(ct.auth), auth.RequirePermission("patients:manage"), func(c *gin.Context) {
		v, err := ct.svc.Get(c.Request.Context())
		if err != nil {
			shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
			return
		}
		c.JSON(http.StatusOK, v)
	})
}
