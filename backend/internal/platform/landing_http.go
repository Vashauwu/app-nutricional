package platform

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/nutri/app-nutricional/backend/internal/shared"
)

// landingFail traduce los errores propios de la landing; el resto sigue por fail.
func (ct *Controller) landingFail(c *gin.Context, err error) {
	var inv *LandingInvalid
	switch {
	case errors.As(err, &inv):
		// Mismo formato que el resto de la API (error.fields: campo → mensaje) para que la pantalla marque cada campo.
		fields := map[string]string{}
		for _, e := range inv.Errors {
			if prev, ok := fields[e.Path]; ok {
				fields[e.Path] = prev + "; " + e.Message
			} else {
				fields[e.Path] = e.Message
			}
		}
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, gin.H{"error": gin.H{"code": "invalid_content", "message": "El contenido tiene " + strconv.Itoa(len(inv.Errors)) + " problema(s): corrígelos y vuelve a guardar.", "fields": fields}})
	case errors.Is(err, ErrLandingPending):
		shared.AbortWithError(c, http.StatusConflict, "landing_pending", capitalize(ErrLandingPending.Error())+".")
	case errors.Is(err, ErrNoDraft):
		shared.AbortWithError(c, http.StatusConflict, "no_draft", capitalize(ErrNoDraft.Error())+".")
	case errors.Is(err, ErrNotPending):
		shared.AbortWithError(c, http.StatusConflict, "not_pending", capitalize(ErrNotPending.Error())+".")
	default:
		ct.fail(c, err)
	}
}

func (ct *Controller) landingState(c *gin.Context) {
	st, err := ct.svc.Landing(c.Request.Context())
	if err != nil {
		ct.landingFail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, st)
}

func (ct *Controller) landingSaveDraft(c *gin.Context) {
	var in LandingContent
	if c.ShouldBindJSON(&in) != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "El contenido no tiene el formato esperado.")
		return
	}
	v, err := ct.svc.SaveLandingDraft(c.Request.Context(), ct.actor(c), in)
	if err != nil {
		ct.landingFail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (ct *Controller) landingRequest(c *gin.Context) {
	var in reasonReq
	_ = c.ShouldBindJSON(&in)
	v, err := ct.svc.RequestLanding(c.Request.Context(), ct.actor(c), in.Reason)
	if err != nil {
		ct.landingFail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (ct *Controller) landingWithdraw(c *gin.Context) {
	v, err := ct.svc.WithdrawLanding(c.Request.Context(), ct.actor(c))
	if err != nil {
		ct.landingFail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (ct *Controller) landingDecide(c *gin.Context) {
	var in struct {
		Approve bool   `json:"approve"`
		Note    string `json:"note"`
	}
	if c.ShouldBindJSON(&in) != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Indica si apruebas o rechazas.")
		return
	}
	st, err := ct.svc.DecideLanding(c.Request.Context(), ct.actor(c), in.Approve, in.Note)
	if err != nil {
		ct.landingFail(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

func (ct *Controller) landingVersions(c *gin.Context) {
	rows, err := ct.svc.LandingVersions(c.Request.Context())
	if err != nil {
		ct.landingFail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": rows})
}

func (ct *Controller) landingVersion(c *gin.Context) {
	n, err := strconv.Atoi(c.Param("n"))
	if err != nil || n < 1 {
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No existe.")
		return
	}
	v, err := ct.svc.LandingVersionByNumber(c.Request.Context(), n)
	if err != nil {
		ct.landingFail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (ct *Controller) landingRestore(c *gin.Context) {
	n, err := strconv.Atoi(c.Param("n"))
	if err != nil || n < 1 {
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No existe.")
		return
	}
	v, err := ct.svc.RestoreLanding(c.Request.Context(), ct.actor(c), n)
	if err != nil {
		ct.landingFail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

// publicLanding: contenido publicado de la landing, sin sesión. ETag por versión: el navegador revalida sin descargar de nuevo.
func (ct *Controller) publicLanding(c *gin.Context) {
	v, err := ct.svc.PublishedLanding(c.Request.Context())
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.Header("Cache-Control", "public, max-age=60")
			c.Status(http.StatusNotFound)
			return
		}
		ct.fail(c, err)
		return
	}
	etag := `"landing-` + strconv.Itoa(*v.Number) + `"`
	c.Header("ETag", etag)
	c.Header("Cache-Control", "public, max-age=60")
	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": *v.Number, "published_at": v.PublishedAt, "content": v.Content})
}
