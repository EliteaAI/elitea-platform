// Package apierr defines the standard API error response format used across
// elitea-main, matching the structure returned by the legacy Python service.
package apierr

import (
	"encoding/json"
	"net/http"
)

// ErrorDetail carries the machine-readable code and human-readable message.
type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Response is the top-level error envelope: {"error": {"code":"...", "message":"..."}}.
type Response struct {
	Error ErrorDetail `json:"error"`
}

// New creates an ErrorDetail with the given code and message.
func New(code, message string) ErrorDetail {
	return ErrorDetail{Code: code, Message: message}
}

// Write encodes an error response as JSON and sets the HTTP status code.
func Write(w http.ResponseWriter, statusCode int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(Response{Error: New(code, message)})
}

// Common error writers.

func BadRequest(w http.ResponseWriter, message string) {
	Write(w, http.StatusBadRequest, "bad_request", message)
}

func Unauthorized(w http.ResponseWriter, message string) {
	Write(w, http.StatusUnauthorized, "unauthorized", message)
}

func Forbidden(w http.ResponseWriter, message string) {
	Write(w, http.StatusForbidden, "forbidden", message)
}

func NotFound(w http.ResponseWriter, message string) {
	Write(w, http.StatusNotFound, "not_found", message)
}

func InternalServer(w http.ResponseWriter, message string) {
	Write(w, http.StatusInternalServerError, "internal_server_error", message)
}

func TooManyRequests(w http.ResponseWriter, message string) {
	Write(w, http.StatusTooManyRequests, "too_many_requests", message)
}
