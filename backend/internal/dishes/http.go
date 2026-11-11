package dishes

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
	"github.com/nutri/app-nutricional/backend/internal/smae"
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

func (ct *Controller) fail(c *gin.Context, err error) {
	var ve ValidationError
	var sv smae.ValidationError
	switch {
	case errors.As(err, &ve):
		ct.validation(c, ve)
	case errors.As(err, &sv):
		ct.validation(c, ValidationError(sv))
	case errors.Is(err, ErrNotFound):
		shared.AbortWithError(c, http.StatusNotFound, "not_found", "No encontrado.")
	case errors.Is(err, ErrRecalcRequired):
		shared.AbortWithError(c, http.StatusConflict, "recalc_required", ErrRecalcRequired.Error()+".")
	case errors.Is(err, ErrAlreadyDecided):
		shared.AbortWithError(c, http.StatusConflict, "already_decided", ErrAlreadyDecided.Error()+".")
	case errors.Is(err, ErrEditionState):
		shared.AbortWithError(c, http.StatusConflict, "edition_state", ErrEditionState.Error()+".")
	case errors.Is(err, smae.ErrNoActive):
		shared.AbortWithError(c, http.StatusConflict, "no_active_edition", "No hay una edición SMAE activa.")
	default:
		ct.log.ErrorContext(c.Request.Context(), "dishes_internal_error", slog.String("request_id", middleware.GetRequestID(c)), slog.Any("error", err))
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
	}
}

func (ct *Controller) validation(c *gin.Context, f ValidationError) {
	c.AbortWithStatusJSON(http.StatusUnprocessableEntity, shared.ErrorBody{Error: shared.ErrorDetail{
		Code: "validation_failed", Message: "Revisa los datos marcados.", RequestID: middleware.GetRequestID(c), Fields: f}})
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	d := v1.Group("/dishes", auth.Authenticate(ct.auth), auth.RequirePermission("dishes:manage"), auth.CSRF())
	d.GET("", ct.list)
	d.POST("", ct.create)
	d.GET("/:id", ct.get)
	d.POST("/:id/versions", ct.newVersion)
	d.POST("/:id/duplicate", ct.duplicate)
	d.POST("/:id/active", ct.active)
	d.GET("/:id/substitute-candidates", ct.candidates)
	d.GET("/:id/usage", ct.usage)
	d.POST("/:id/substitutions", ct.addSub)
	d.DELETE("/:id/substitutions/:sid", ct.removeSub)

	e := v1.Group("/smae/editions/:id", auth.Authenticate(ct.auth), auth.RequirePermission("smae:manage"), auth.CSRF())
	e.GET("/impact", ct.impact)
	e.POST("/recalc", ct.recalc)
	e.POST("/activate", ct.activate)
}

func pathID(c *gin.Context, key string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(key))
	return id, err == nil
}

func qInt(c *gin.Context, key string) int {
	n, _ := strconv.Atoi(c.Query(key))
	return n
}

func (ct *Controller) list(c *gin.Context) {
	res, err := ct.svc.List(c.Request.Context(), ListQuery{
		Search: c.Query("search"), Category: c.Query("category"), SubgroupCode: c.Query("subgroup_code"), Status: c.Query("status"), Limit: qInt(c, "limit"), Offset: qInt(c, "offset"),
	})
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

type dishReq struct {
	Name             string          `json:"name"`
	Category         string          `json:"category"`
	Description      string          `json:"description"`
	RecipeMode       string          `json:"recipe_mode"`
	InstructionsText string          `json:"instructions_text"`
	Recommendations  string          `json:"recommendations"`
	ChangeReason     string          `json:"change_reason"`
	Tags             []string        `json:"tags"`
	Steps            []string        `json:"steps"`
	Servings         decimal.Decimal `json:"servings"`
	PrepTimeMinutes  int             `json:"prep_time_minutes"`
	ImageFileID      *uuid.UUID      `json:"image_file_id"`
	Ingredients      []struct {
		FoodKind string          `json:"food_kind"`
		FoodID   uuid.UUID       `json:"food_id"`
		Quantity decimal.Decimal `json:"quantity"`
		Unit     string          `json:"unit"`
	} `json:"ingredients"`
}

func (r dishReq) input() Input {
	in := Input{Name: r.Name, Category: r.Category, Description: r.Description, RecipeMode: r.RecipeMode, InstructionsText: r.InstructionsText, Recommendations: r.Recommendations,
		ChangeReason: r.ChangeReason, Tags: r.Tags, Steps: r.Steps, Servings: r.Servings, PrepTimeMinutes: r.PrepTimeMinutes, ImageFileID: r.ImageFileID}
	for _, i := range r.Ingredients {
		in.Ingredients = append(in.Ingredients, IngredientInput{FoodKind: i.FoodKind, FoodID: i.FoodID, Quantity: i.Quantity, Unit: i.Unit})
	}
	return in
}

func (ct *Controller) create(c *gin.Context) {
	var r dishReq
	if err := c.ShouldBindJSON(&r); err != nil {
		ct.validation(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	v, err := ct.svc.Create(c.Request.Context(), actor(c), r.input())
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (ct *Controller) get(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	v, err := ct.svc.Get(c.Request.Context(), id, int32(qInt(c, "version")))
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (ct *Controller) newVersion(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	var r dishReq
	if err := c.ShouldBindJSON(&r); err != nil {
		ct.validation(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	v, err := ct.svc.NewVersion(c.Request.Context(), actor(c), id, r.input())
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (ct *Controller) duplicate(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	v, err := ct.svc.Duplicate(c.Request.Context(), actor(c), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (ct *Controller) active(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	var in struct {
		Active bool `json:"active"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		ct.validation(c, ValidationError{"active": "indica true o false"})
		return
	}
	if err := ct.svc.SetActive(c.Request.Context(), actor(c), id, in.Active); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) candidates(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	var pid uuid.UUID
	if raw := c.Query("patient_id"); raw != "" {
		p, err := uuid.Parse(raw)
		if err != nil {
			ct.validation(c, ValidationError{"patient_id": "identificador inválido"})
			return
		}
		pid = p
	}
	l, err := ct.svc.Candidates(c.Request.Context(), id, pid)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": l})
}

func (ct *Controller) addSub(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	var in struct {
		SubstituteDishID uuid.UUID `json:"substitute_dish_id"`
		Version          int32     `json:"version"`
		Note             string    `json:"note"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		ct.validation(c, ValidationError{"body": "revisa los campos enviados"})
		return
	}
	s, err := ct.svc.AddSubstitution(c.Request.Context(), actor(c), id, in.Version, in.SubstituteDishID, in.Note)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, s)
}

func (ct *Controller) removeSub(c *gin.Context) {
	id, ok1 := pathID(c, "id")
	sid, ok2 := pathID(c, "sid")
	if !ok1 || !ok2 {
		ct.fail(c, ErrNotFound)
		return
	}
	if err := ct.svc.RemoveSubstitution(c.Request.Context(), actor(c), id, int32(qInt(c, "version")), sid); err != nil {
		ct.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (ct *Controller) impact(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	rows, err := ct.svc.Impact(c.Request.Context(), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	if rows == nil {
		rows = []ImpactRow{}
	}
	c.JSON(http.StatusOK, gin.H{"items": rows})
}

func (ct *Controller) recalc(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	var in struct {
		Decisions []struct {
			DishID    uuid.UUID `json:"dish_id"`
			Authorize bool      `json:"authorize"`
		} `json:"decisions"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		ct.validation(c, ValidationError{"decisions": "indica una decisión por platillo afectado"})
		return
	}
	ds := make([]Decision, 0, len(in.Decisions))
	for _, d := range in.Decisions {
		ds = append(ds, Decision{DishID: d.DishID, Authorize: d.Authorize})
	}
	res, err := ct.svc.ApplyRecalc(c.Request.Context(), actor(c), id, ds)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (ct *Controller) activate(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	ed, err := ct.svc.ActivateEdition(c.Request.Context(), actor(c), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, ed)
}

func (ct *Controller) usage(c *gin.Context) {
	id, ok := pathID(c, "id")
	if !ok {
		ct.fail(c, ErrNotFound)
		return
	}
	n, err := ct.svc.UsedInPlans(c.Request.Context(), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"plans": n})
}
