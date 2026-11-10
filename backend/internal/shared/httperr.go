// Package shared contiene tipos comunes a todos los módulos.
package shared

import "github.com/gin-gonic/gin"

// ErrorBody es el formato uniforme de error de la API (§21.6).
type ErrorBody struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code      string            `json:"code"`
	Message   string            `json:"message"`
	RequestID string            `json:"request_id,omitempty"`
	Fields    map[string]string `json:"fields,omitempty"`
}

func AbortWithError(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, ErrorBody{Error: ErrorDetail{
		Code:      code,
		Message:   message,
		RequestID: c.GetString("request_id"),
	}})
}
