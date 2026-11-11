package storage

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/shared"
)

// PatientLookup resuelve la paciente asociada a una cuenta (sin exigir consentimientos).
type PatientLookup func(c *gin.Context, userID uuid.UUID) (uuid.UUID, error)

type Controller struct {
	svc       *Service
	auth      *auth.Service
	lookup    PatientLookup
	maxUpload int64
	log       *slog.Logger
}

func NewController(svc *Service, a *auth.Service, lookup PatientLookup, maxUpload int64, log *slog.Logger) *Controller {
	return &Controller{svc: svc, auth: a, lookup: lookup, maxUpload: maxUpload, log: log}
}

func actorOf(c *gin.Context) Actor {
	return Actor{ID: auth.IdentityFrom(c).UserID, RequestID: middleware.GetRequestID(c)}
}

func (ct *Controller) fail(c *gin.Context, err error) {
	rid := middleware.GetRequestID(c)
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{Code: "validation_failed", Message: "Revisa los datos marcados.", RequestID: rid, Fields: ve}})
	case errors.Is(err, ErrNotFound):
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No se encontró el recurso.")
	case errors.Is(err, ErrTooLarge):
		shared.AbortWithError(c, http.StatusRequestEntityTooLarge, "file_too_large", err.Error())
	case errors.Is(err, ErrQuotaExceeded):
		shared.AbortWithError(c, http.StatusInsufficientStorage, "quota_exceeded", err.Error())
	case errors.Is(err, ErrConsentPending):
		shared.AbortWithError(c, http.StatusLocked, "consent_pending", err.Error())
	default:
		ct.log.ErrorContext(c.Request.Context(), "storage_internal_error", slog.String("request_id", rid), slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
	}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	nutri := v1.Group("", auth.Authenticate(ct.auth), auth.RequirePermission("patients:manage"), auth.CSRF())
	nutri.POST("/uploads/images", ct.uploadImage)
	nutri.GET("/patients/:id/documents", ct.listDocs)
	nutri.POST("/patients/:id/documents", ct.addDoc)
	nutri.PUT("/patients/:id/documents/:doc", ct.updateDoc)
	nutri.DELETE("/patients/:id/documents/:doc", ct.deleteDoc)
	nutri.GET("/patients/:id/storage", ct.usage)

	me := v1.Group("/me", auth.Authenticate(ct.auth), auth.RequirePermission("patients:read_own"), auth.CSRF())
	me.GET("/documents", ct.myDocs)

	v1.GET("/files/:id", auth.Authenticate(ct.auth), ct.file)
}

func pathID(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No se encontró el recurso.")
		return uuid.Nil, false
	}
	return id, true
}

// readUpload limita el tamaño ANTES de leer a memoria y devuelve el archivo del campo "file".
func (ct *Controller) readUpload(c *gin.Context) ([]byte, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, ct.maxUpload)
	fh, err := c.FormFile("file")
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			ct.fail(c, ErrTooLarge)
		} else {
			ct.fail(c, ValidationError{"file": "adjunta un archivo en el campo «file»"})
		}
		return nil, false
	}
	f, err := fh.Open()
	if err != nil {
		ct.fail(c, ValidationError{"file": "no se pudo leer el archivo"})
		return nil, false
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		ct.fail(c, ErrTooLarge)
		return nil, false
	}
	return data, true
}

func (ct *Controller) uploadImage(c *gin.Context) {
	data, ok := ct.readUpload(c)
	if !ok {
		return
	}
	var owner *uuid.UUID
	if s := c.PostForm("patient_id"); s != "" {
		id, err := uuid.Parse(s)
		if err != nil {
			ct.fail(c, ValidationError{"patient_id": "identificador no válido"})
			return
		}
		owner = &id
	}
	v, err := ct.svc.UploadImage(c.Request.Context(), actorOf(c), c.PostForm("kind"), owner, data)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

func docInput(c *gin.Context) (DocumentInput, error) {
	in := DocumentInput{Name: c.PostForm("name"), Category: c.PostForm("category"), Description: c.PostForm("description"),
		Visible: c.PostForm("visible_to_patient") == "true"}
	d, err := time.Parse("2006-01-02", c.PostForm("document_date"))
	if err != nil {
		return in, ValidationError{"document_date": "indica una fecha válida (AAAA-MM-DD)"}
	}
	in.DocumentDate = d
	return in, nil
}

func (ct *Controller) addDoc(c *gin.Context) {
	pid, ok := pathID(c, "id")
	if !ok {
		return
	}
	data, ok := ct.readUpload(c)
	if !ok {
		return
	}
	in, err := docInput(c)
	if err != nil {
		ct.fail(c, err)
		return
	}
	d, err := ct.svc.AddDocument(c.Request.Context(), actorOf(c), pid, in, data)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, d)
}

func (ct *Controller) listDocs(c *gin.Context) {
	pid, ok := pathID(c, "id")
	if !ok {
		return
	}
	l, err := ct.svc.ListDocuments(c.Request.Context(), pid, false)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": l})
}

func (ct *Controller) updateDoc(c *gin.Context) {
	pid, ok := pathID(c, "id")
	if !ok {
		return
	}
	did, ok := pathID(c, "doc")
	if !ok {
		return
	}
	var body struct {
		Name        string `json:"name"`
		Category    string `json:"category"`
		Description string `json:"description"`
		Date        string `json:"document_date"`
		Visible     bool   `json:"visible_to_patient"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		ct.fail(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	d, err := time.Parse("2006-01-02", body.Date)
	if err != nil {
		ct.fail(c, ValidationError{"document_date": "indica una fecha válida (AAAA-MM-DD)"})
		return
	}
	out, err := ct.svc.UpdateDocument(c.Request.Context(), actorOf(c), pid, did, DocumentInput{Name: body.Name, Category: body.Category, Description: body.Description, DocumentDate: d, Visible: body.Visible})
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (ct *Controller) deleteDoc(c *gin.Context) {
	pid, ok := pathID(c, "id")
	if !ok {
		return
	}
	did, ok := pathID(c, "doc")
	if !ok {
		return
	}
	if err := ct.svc.DeleteDocument(c.Request.Context(), actorOf(c), pid, did); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) usage(c *gin.Context) {
	pid, ok := pathID(c, "id")
	if !ok {
		return
	}
	u, err := ct.svc.Usage(c.Request.Context(), pid)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, u)
}

func (ct *Controller) myDocs(c *gin.Context) {
	pid, err := ct.lookup(c, auth.IdentityFrom(c).UserID)
	if err != nil {
		ct.fail(c, ErrNotFound)
		return
	}
	if err := ct.svc.requireConsent(c.Request.Context(), pid); err != nil {
		ct.fail(c, err)
		return
	}
	l, err := ct.svc.ListDocuments(c.Request.Context(), pid, true)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": l})
}

// file sirve un archivo tras autorizar; nunca expone la ruta física.
func (ct *Controller) file(c *gin.Context) {
	fid, ok := pathID(c, "id")
	if !ok {
		return
	}
	idn := auth.IdentityFrom(c)
	p := Principal{UserID: idn.UserID, Role: idn.Role}
	if idn.Role == "patient" {
		pid, err := ct.lookup(c, idn.UserID)
		if err != nil {
			ct.fail(c, ErrNotFound)
			return
		}
		p.PatientID = pid
	}
	f, rc, err := ct.svc.Open(c.Request.Context(), p, fid, c.Query("thumb") == "1")
	if err != nil {
		ct.fail(c, err)
		return
	}
	defer rc.Close()
	mime := f.MimeType
	c.Header("X-Content-Type-Options", "nosniff")
	if f.Visibility == "private" {
		c.Header("Cache-Control", "private, no-store")
	} else {
		c.Header("Cache-Control", "private, max-age=3600")
	}
	disp := "inline"
	if !strings.HasPrefix(mime, "image/") && mime != "application/pdf" {
		disp = "attachment"
	}
	c.Header("Content-Disposition", disp)
	c.DataFromReader(http.StatusOK, -1, mime, rc, nil)
}
