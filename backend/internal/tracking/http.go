package tracking

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/shared"
	"github.com/nutri/app-nutricional/backend/internal/storage"
)

// PatientResolver obtiene la paciente de la sesión y exige expediente habilitado (devuelve ErrConsentPending si no).
type PatientResolver func(c *gin.Context, userID uuid.UUID) (uuid.UUID, error)

type Controller struct {
	svc       *Service
	auth      *auth.Service
	patient   PatientResolver
	maxUpload int64
	log       *slog.Logger
}

func NewController(svc *Service, a *auth.Service, r PatientResolver, maxUpload int64, log *slog.Logger) *Controller {
	return &Controller{svc: svc, auth: a, patient: r, maxUpload: maxUpload, log: log}
}

func (ct *Controller) fail(c *gin.Context, err error) {
	rid := middleware.GetRequestID(c)
	var fields map[string]string
	var tv ValidationError
	var sv storage.ValidationError
	switch {
	case errors.As(err, &tv):
		fields = tv
	case errors.As(err, &sv):
		fields = sv
	}
	switch {
	case fields != nil:
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{Code: "validation_failed", Message: "Revisa los datos marcados.", RequestID: rid, Fields: fields}})
	case errors.Is(err, ErrNotFound):
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No se encontró el recurso.")
	case errors.Is(err, ErrConsentPending):
		shared.AbortWithError(c, http.StatusLocked, "consent_pending", err.Error())
	case errors.Is(err, ErrUnavailable):
		shared.AbortWithError(c, http.StatusServiceUnavailable, "storage_unavailable", err.Error())
	case errors.Is(err, storage.ErrTooLarge):
		shared.AbortWithError(c, http.StatusRequestEntityTooLarge, "file_too_large", err.Error())
	case errors.Is(err, storage.ErrQuotaExceeded):
		shared.AbortWithError(c, http.StatusInsufficientStorage, "quota_exceeded", err.Error())
	default:
		ct.log.ErrorContext(c.Request.Context(), "tracking_internal_error", slog.String("request_id", rid), slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
	}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	staff := v1.Group("", auth.Authenticate(ct.auth), auth.RequirePermission("tracking:review"), auth.CSRF())
	staff.GET("/tracking", ct.feed)
	staff.POST("/tracking/:id/comments", ct.staffComment)
	staff.POST("/tracking/:id/review", ct.review)
	staff.GET("/patients/:id/compliance", ct.staffCompliance)

	me := v1.Group("/me", auth.Authenticate(ct.auth), auth.RequirePermission("tracking:write_own"), auth.CSRF())
	me.GET("/tracking", ct.myFeed)
	me.PUT("/tracking/items/:item", ct.record)
	me.DELETE("/tracking/:id", ct.clear)
	me.POST("/tracking/:id/comments", ct.myComment)
	me.POST("/tracking/:id/photos", ct.myPhoto)
	me.GET("/compliance", ct.myCompliance)
}

func (ct *Controller) actor(c *gin.Context) Actor {
	id := auth.IdentityFrom(c)
	return Actor{ID: id.UserID, Role: roleOf(id.Role), Name: id.Name, RequestID: middleware.GetRequestID(c)}
}

func roleOf(r string) string {
	if r == "patient" {
		return "patient"
	}
	return "nutritionist"
}

func idParam(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No se encontró el recurso.")
		return uuid.Nil, false
	}
	return id, true
}

func dateQuery(c *gin.Context, name string) (*time.Time, error) {
	s := c.Query(name)
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, ValidationError{name: "usa el formato AAAA-MM-DD"}
	}
	return &t, nil
}

func (ct *Controller) mePatient(c *gin.Context) (uuid.UUID, bool) {
	pid, err := ct.patient(c, auth.IdentityFrom(c).UserID)
	if err != nil {
		if errors.Is(err, ErrConsentPending) {
			ct.fail(c, err)
		} else {
			ct.fail(c, ErrNotFound)
		}
		return uuid.Nil, false
	}
	return pid, true
}

// ---------- Nutrióloga ----------
func (ct *Controller) feed(c *gin.Context) {
	q := FeedQuery{Kind: c.Query("kind"), Search: c.Query("search")}
	q.Page, _ = strconv.Atoi(c.Query("page"))
	q.PageSize, _ = strconv.Atoi(c.Query("page_size"))
	if s := c.Query("patient_id"); s != "" {
		id, err := uuid.Parse(s)
		if err != nil {
			ct.fail(c, ValidationError{"patient_id": "identificador no válido"})
			return
		}
		q.PatientID = &id
	}
	var err error
	if q.From, err = dateQuery(c, "from"); err != nil {
		ct.fail(c, err)
		return
	}
	if q.To, err = dateQuery(c, "to"); err != nil {
		ct.fail(c, err)
		return
	}
	p, err := ct.svc.Feed(c.Request.Context(), q)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

type commentBody struct {
	Body string `json:"body"`
}

func (ct *Controller) staffComment(c *gin.Context) {
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	var in commentBody
	if c.ShouldBindJSON(&in) != nil {
		ct.fail(c, ValidationError{"body": "escribe un comentario"})
		return
	}
	v, err := ct.svc.AddComment(c.Request.Context(), ct.actor(c), uuid.Nil, id, in.Body)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (ct *Controller) review(c *gin.Context) {
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	if err := ct.svc.MarkReviewed(c.Request.Context(), ct.actor(c), id); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) compliance(c *gin.Context, patient uuid.UUID) {
	from, err := dateQuery(c, "from")
	if err != nil {
		ct.fail(c, err)
		return
	}
	to, err := dateQuery(c, "to")
	if err != nil {
		ct.fail(c, err)
		return
	}
	out, err := ct.svc.Compliance(c.Request.Context(), patient, from, to)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (ct *Controller) staffCompliance(c *gin.Context) {
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	ct.compliance(c, id)
}

// ---------- Paciente (siempre desde su sesión, nunca desde la URL) ----------
func (ct *Controller) myFeed(c *gin.Context) {
	pid, ok := ct.mePatient(c)
	if !ok {
		return
	}
	q := FeedQuery{PatientID: &pid, PageSize: 100, Page: 1}
	var err error
	if q.From, err = dateQuery(c, "from"); err != nil {
		ct.fail(c, err)
		return
	}
	if q.To, err = dateQuery(c, "to"); err != nil {
		ct.fail(c, err)
		return
	}
	p, err := ct.svc.Feed(c.Request.Context(), q)
	if err != nil {
		ct.fail(c, err)
		return
	}
	p.Pending = 0 // dato interno de la nutrióloga
	c.JSON(http.StatusOK, p)
}

func (ct *Controller) record(c *gin.Context) {
	pid, ok := ct.mePatient(c)
	if !ok {
		return
	}
	item, ok := idParam(c, "item")
	if !ok {
		return
	}
	var in struct {
		Status  string  `json:"status"`
		Comment *string `json:"comment"`
	}
	if c.ShouldBindJSON(&in) != nil {
		ct.fail(c, ValidationError{"status": "indica el estado de la comida"})
		return
	}
	v, err := ct.svc.Record(c.Request.Context(), ct.actor(c), pid, item, in.Status, in.Comment)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (ct *Controller) clear(c *gin.Context) {
	pid, ok := ct.mePatient(c)
	if !ok {
		return
	}
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	if err := ct.svc.Clear(c.Request.Context(), ct.actor(c), pid, id); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) myComment(c *gin.Context) {
	pid, ok := ct.mePatient(c)
	if !ok {
		return
	}
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	var in commentBody
	if c.ShouldBindJSON(&in) != nil {
		ct.fail(c, ValidationError{"body": "escribe un comentario"})
		return
	}
	v, err := ct.svc.AddComment(c.Request.Context(), ct.actor(c), pid, id, in.Body)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (ct *Controller) myPhoto(c *gin.Context) {
	pid, ok := ct.mePatient(c)
	if !ok {
		return
	}
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, ct.maxUpload)
	fh, err := c.FormFile("file")
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			ct.fail(c, storage.ErrTooLarge)
		} else {
			ct.fail(c, ValidationError{"file": "adjunta una fotografía en el campo «file»"})
		}
		return
	}
	f, err := fh.Open()
	if err != nil {
		ct.fail(c, ValidationError{"file": "no se pudo leer el archivo"})
		return
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		ct.fail(c, storage.ErrTooLarge)
		return
	}
	v, err := ct.svc.AddPhoto(c.Request.Context(), ct.actor(c), pid, id, c.PostForm("alt"), data)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (ct *Controller) myCompliance(c *gin.Context) {
	pid, ok := ct.mePatient(c)
	if !ok {
		return
	}
	ct.compliance(c, pid)
}
