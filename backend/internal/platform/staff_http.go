package platform

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/nutri/app-nutricional/backend/internal/shared"
)

func (ct *Controller) staffList(c *gin.Context) {
	rows, err := ct.svc.Staff(c.Request.Context())
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": rows, "roles": StaffRoles})
}

func (ct *Controller) staffInvite(c *gin.Context) {
	var in struct {
		Email string `json:"email"`
		Name  string `json:"name"`
		Role  string `json:"role"`
	}
	if c.ShouldBindJSON(&in) != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Completa el correo, el nombre y el rol.")
		return
	}
	r, err := ct.svc.InviteStaff(c.Request.Context(), ct.actor(c), in.Email, in.Name, in.Role)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusCreated, r)
}

func (ct *Controller) staffResend(c *gin.Context) {
	id, ok := uid(c)
	if !ok {
		return
	}
	r, err := ct.svc.ResendStaffInvite(c.Request.Context(), ct.actor(c), id)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, r)
}

func (ct *Controller) staffRole(c *gin.Context) {
	id, ok := uid(c)
	if !ok {
		return
	}
	var in struct {
		Role string `json:"role"`
	}
	if c.ShouldBindJSON(&in) != nil {
		shared.AbortWithError(c, http.StatusBadRequest, "invalid_request", "Elige un rol.")
		return
	}
	r, err := ct.svc.SetStaffRole(c.Request.Context(), ct.actor(c), id, in.Role)
	if err != nil {
		ct.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, r)
}

func (ct *Controller) staffEnable(enabled bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := uid(c)
		if !ok {
			return
		}
		r, err := ct.svc.SetStaffEnabled(c.Request.Context(), ct.actor(c), id, enabled)
		if err != nil {
			ct.fail(c, err)
			return
		}
		c.JSON(http.StatusOK, r)
	}
}
