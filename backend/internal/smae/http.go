package smae

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/shared"
)

type Controller struct {
	svc  *Service
	auth *auth.Service
	log  *slog.Logger
}

func NewController(svc *Service, authSvc *auth.Service, log *slog.Logger) *Controller {
	return &Controller{svc: svc, auth: authSvc, log: log}
}

func actor(c *gin.Context) Actor {
	return Actor{ID: auth.IdentityFrom(c).UserID, RequestID: middleware.GetRequestID(c)}
}

func Fail(c *gin.Context, log *slog.Logger, err error) {
	var ve ValidationError
	switch {
	case errors.As(err, &ve):
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{
			Code: "validation_failed", Message: "Revisa los datos marcados.", RequestID: middleware.GetRequestID(c), Fields: ve}})
	case errors.Is(err, ErrNotFound):
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No encontrado.")
	case errors.Is(err, ErrNoActive):
		shared.AbortWithError(c, http.StatusConflict, "no_active_edition", "No hay una edición SMAE activa. Importa y activa una edición primero.")
	default:
		log.ErrorContext(c.Request.Context(), "smae_internal_error", slog.String("request_id", middleware.GetRequestID(c)), slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
	}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	g := v1.Group("", auth.Authenticate(ct.auth), auth.RequirePermission("smae:manage"), auth.CSRF())
	g.GET("/smae/taxonomy", ct.taxonomy)
	g.GET("/smae/editions", ct.editions)
	g.POST("/smae/editions", ct.importEdition)
	g.GET("/smae/foods", ct.foods)
	g.GET("/smae/foods/:kind/:id", ct.food)
	g.GET("/custom-foods", ct.listCustom)
	g.POST("/custom-foods", ct.saveCustom)
	g.PUT("/custom-foods/:id", ct.saveCustom)
	g.POST("/custom-foods/:id/validate", ct.validateCustom)
	g.POST("/custom-foods/:id/equivalence", ct.equivalence)
	g.POST("/custom-foods/:id/active", ct.customActive)
}

func (ct *Controller) taxonomy(c *gin.Context) {
	ed, err := ct.svc.ActiveEdition(c.Request.Context())
	if err != nil {
		Fail(c, ct.log, err)
		return
	}
	t, err := ct.svc.Taxonomy(c.Request.Context(), ed.ID)
	if err != nil {
		Fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, t)
}

func (ct *Controller) editions(c *gin.Context) {
	l, err := ct.svc.Editions(c.Request.Context())
	if err != nil {
		Fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": l})
}

func (ct *Controller) importEdition(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 20<<20)
	var p ImportPayload
	if err := c.ShouldBindJSON(&p); err != nil {
		Fail(c, ct.log, ValidationError{"body": "el archivo de importación no tiene un formato JSON válido o excede 20 MB"})
		return
	}
	rep, err := ct.svc.ImportEdition(c.Request.Context(), actor(c), p)
	if err != nil {
		Fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusCreated, rep)
}

func atoi(c *gin.Context, key string) int {
	n, _ := strconv.Atoi(c.Query(key))
	return n
}

func (ct *Controller) foods(c *gin.Context) {
	var gid uuid.UUID
	if raw := c.Query("group_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			Fail(c, ct.log, ValidationError{"group_id": "identificador inválido"})
			return
		}
		gid = id
	}
	page, err := ct.svc.SearchFoods(c.Request.Context(), SearchQuery{Search: c.Query("search"), GroupID: gid, Source: c.Query("source"), Limit: atoi(c, "limit"), Offset: atoi(c, "offset")})
	if err != nil {
		Fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

func (ct *Controller) food(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		Fail(c, ct.log, ErrNotFound)
		return
	}
	f, err := ct.svc.Resolve(c.Request.Context(), c.Param("kind"), id)
	if err != nil {
		if _, ok := err.(ValidationError); ok {
			Fail(c, ct.log, ErrNotFound)
			return
		}
		Fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, f)
}

type customReq struct {
	Name            string           `json:"name"`
	Brand           string           `json:"brand"`
	Description     string           `json:"description"`
	BasisQuantity   decimal.Decimal  `json:"basis_quantity"`
	BasisUnit       string           `json:"basis_unit"`
	EnergyKcal      decimal.Decimal  `json:"energy_kcal"`
	ProteinG        decimal.Decimal  `json:"protein_g"`
	CarbohydratesG  decimal.Decimal  `json:"carbohydrates_g"`
	LipidsG         decimal.Decimal  `json:"lipids_g"`
	FiberG          decimal.Decimal  `json:"fiber_g"`
	DensityGPerMl   *decimal.Decimal `json:"density_g_per_ml"`
	SourceType      string           `json:"source_type"`
	SourceReference string           `json:"source_reference"`
	Tags            []string         `json:"tags"`
	Portions        []struct {
		Name            string          `json:"name"`
		Unit            string          `json:"unit"`
		Quantity        decimal.Decimal `json:"quantity"`
		GramsEquivalent decimal.Decimal `json:"grams_equivalent"`
	} `json:"portions"`
}

func (ct *Controller) saveCustom(c *gin.Context) {
	var in customReq
	if err := c.ShouldBindJSON(&in); err != nil {
		Fail(c, ct.log, ValidationError{"body": "revisa los campos enviados (los números van como texto o número válido)"})
		return
	}
	if in.BasisUnit == "" {
		in.BasisUnit = "g"
	}
	ci := CustomInput{
		Name: in.Name, Brand: in.Brand, Description: in.Description, BasisQuantity: in.BasisQuantity, BasisUnit: in.BasisUnit, Energy: in.EnergyKcal,
		Protein: in.ProteinG, Carbs: in.CarbohydratesG, Lipids: in.LipidsG, Fiber: in.FiberG, DensityGPerMl: in.DensityGPerMl, SourceType: in.SourceType,
		SourceReference: in.SourceReference, Tags: in.Tags,
	}
	for _, p := range in.Portions {
		ci.Portions = append(ci.Portions, PortionInput{Name: p.Name, Unit: p.Unit, Quantity: p.Quantity, GramsEquivalent: p.GramsEquivalent})
	}
	var (
		f   Food
		err error
	)
	if raw := c.Param("id"); raw != "" {
		id, perr := uuid.Parse(raw)
		if perr != nil {
			Fail(c, ct.log, ErrNotFound)
			return
		}
		f, err = ct.svc.UpdateCustom(c.Request.Context(), actor(c), id, ci)
		if err == nil {
			c.JSON(http.StatusOK, f)
			return
		}
	} else {
		f, err = ct.svc.CreateCustom(c.Request.Context(), actor(c), ci)
		if err == nil {
			c.JSON(http.StatusCreated, f)
			return
		}
	}
	Fail(c, ct.log, err)
}

func (ct *Controller) listCustom(c *gin.Context) {
	page, err := ct.svc.ListCustom(c.Request.Context(), c.Query("search"), c.Query("include_inactive") == "true", atoi(c, "limit"), atoi(c, "offset"))
	if err != nil {
		Fail(c, ct.log, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

func customID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	return id, err == nil
}

func (ct *Controller) validateCustom(c *gin.Context) {
	id, ok := customID(c)
	if !ok {
		Fail(c, ct.log, ErrNotFound)
		return
	}
	if err := ct.svc.ValidateCustom(c.Request.Context(), actor(c), id); err != nil {
		Fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) equivalence(c *gin.Context) {
	id, ok := customID(c)
	if !ok {
		Fail(c, ct.log, ErrNotFound)
		return
	}
	var in struct {
		SubgroupCode   string          `json:"subgroup_code"`
		ReferenceGrams decimal.Decimal `json:"reference_grams"`
		Criterion      string          `json:"criterion"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		Fail(c, ct.log, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	if err := ct.svc.AssignEquivalence(c.Request.Context(), actor(c), id, in.SubgroupCode, in.ReferenceGrams, in.Criterion); err != nil {
		Fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) customActive(c *gin.Context) {
	id, ok := customID(c)
	if !ok {
		Fail(c, ct.log, ErrNotFound)
		return
	}
	var in struct {
		Active bool `json:"active"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		Fail(c, ct.log, ValidationError{"active": "indica true o false"})
		return
	}
	if err := ct.svc.SetCustomActive(c.Request.Context(), actor(c), id, in.Active); err != nil {
		Fail(c, ct.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}
