// Package auditlog expone la consulta de la bitácora de auditoría a quien tenga el permiso audit:read (MVP_SPEC §17.1).
// Es solo lectura: la bitácora es append-only y la escribe cada módulo con internal/audit.
package auditlog

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/shared"
)

type Controller struct {
	q    *db.Queries
	auth *auth.Service
}

func NewController(q db.DBTX, a *auth.Service) *Controller {
	return &Controller{q: db.New(q), auth: a}
}

func (ct *Controller) Register(v1 *gin.RouterGroup) {
	v1.GET("/audit", auth.Authenticate(ct.auth), auth.RequirePermission("audit:read"), ct.list)
}

type Row struct {
	ID           string          `json:"id"`
	At           time.Time       `json:"at"`
	Actor        string          `json:"actor"`
	Action       string          `json:"action"`
	ResourceType string          `json:"resource_type"`
	ResourceID   string          `json:"resource_id"`
	RequestID    string          `json:"request_id"`
	Metadata     json.RawMessage `json:"metadata"`
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(s))
}

func (ct *Controller) list(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	size, _ := strconv.Atoi(c.Query("page_size"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 200 {
		size = 50
	}
	rows, err := ct.q.ListAuditLogs(c.Request.Context(), db.ListAuditLogsParams{Search: escapeLike(c.Query("search")), PageLimit: int32(size), PageOffset: int32((page - 1) * size)})
	if err != nil {
		shared.AbortWithError(c, http.StatusInternalServerError, "internal_error", "Ocurrió un error. Inténtalo de nuevo.")
		return
	}
	out := make([]Row, 0, len(rows))
	total := 0
	for _, r := range rows {
		rid := ""
		if r.ResourceID.Valid {
			rid = r.ResourceID.UUID.String()
		}
		out = append(out, Row{ID: r.ID.String(), At: r.OccurredAt.Time, Actor: r.ActorName, Action: r.Action, ResourceType: r.ResourceType, ResourceID: rid, RequestID: r.RequestID, Metadata: r.Metadata})
		total = int(r.Total)
	}
	c.JSON(http.StatusOK, gin.H{"items": out, "total": total, "page": page, "page_size": size})
}
