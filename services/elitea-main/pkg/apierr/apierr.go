package apierr

import (
	"encoding/json"
	"errors"
	"net/http"
)

type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Response struct {
	Error ErrorDetail `json:"error"`
}

type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return e.Message
}

func BadRequest(message string) error {
	return &APIError{Status: http.StatusBadRequest, Code: "bad_request", Message: message}
}

func NotFound(message string) error {
	return &APIError{Status: http.StatusNotFound, Code: "not_found", Message: message}
}

func Unauthorized(message string) error {
	return &APIError{Status: http.StatusUnauthorized, Code: "unauthorized", Message: message}
}

func Forbidden(message string) error {
	return &APIError{Status: http.StatusForbidden, Code: "forbidden", Message: message}
}

func Internal(message string) error {
	return &APIError{Status: http.StatusInternalServerError, Code: "internal_error", Message: message}
}

func Conflict(message string) error {
	return &APIError{Status: http.StatusConflict, Code: "conflict", Message: message}
}

func Write(w http.ResponseWriter, err error) {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(apiErr.Status)
		json.NewEncoder(w).Encode(Response{Error: ErrorDetail{Code: apiErr.Code, Message: apiErr.Message}})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	json.NewEncoder(w).Encode(Response{Error: ErrorDetail{Code: "internal_error", Message: "internal server error"}})
}
