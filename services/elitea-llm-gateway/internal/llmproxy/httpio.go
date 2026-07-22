package llmproxy

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/maximhq/bifrost/core/providers/anthropic"
	"github.com/maximhq/bifrost/core/schemas"
)

// maxRequestBody bounds a decoded JSON body so a malformed or hostile request
// cannot exhaust memory. It is generous enough for large multi-message chat
// payloads (the multipart image paths use their own ParseMultipartForm limit).
const maxRequestBody = 32 << 20 // 32 MiB

// isStream reports whether a dialect request's optional stream flag is set.
func isStream(v *bool) bool { return v != nil && *v }

// decodeJSON reads and JSON-decodes the request body into dst, writing an
// OpenAI-shaped 400 on any read/parse failure. It reports whether decoding
// succeeded. The body is size-capped via http.MaxBytesReader.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request_error", "invalid request body: "+err.Error(), "")
		return false
	}
	return true
}

// writeJSON applies response-header hygiene, sets the JSON content type, writes
// the status, and marshals v.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	finish(w.Header())
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// openAIError is the OpenAI-shaped nested error envelope: {"error":{...}}.
type openAIError struct {
	Error openAIErrorFields `json:"error"`
}

type openAIErrorFields struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code,omitempty"`
}

// writeError writes an OpenAI-shaped error body at the given status.
func writeError(w http.ResponseWriter, status int, errType, message, code string) {
	writeJSON(w, status, openAIError{Error: openAIErrorFields{Message: message, Type: errType, Code: code}})
}

// statusAndType maps a *schemas.BifrostError to the gateway's HTTP status and
// OpenAI error type. Budget exhaustion is 402 (design §2 — differs from
// LiteLLM's 429); rate limits are 429; auth 401; permission 403; anything else
// falls back to the provider status or 500.
func statusAndType(bErr *schemas.BifrostError) (int, string, string) {
	status := http.StatusInternalServerError
	if bErr.StatusCode != nil && *bErr.StatusCode != 0 {
		status = *bErr.StatusCode
	}

	var errType, code string
	if bErr.Error != nil {
		if bErr.Error.Type != nil {
			errType = *bErr.Error.Type
		}
		if bErr.Error.Code != nil {
			code = *bErr.Error.Code
		}
	}

	// Normalise the well-known governance/infra classes to the platform's
	// contract regardless of what the provider reported.
	switch {
	case isBudgetError(status, errType, code):
		return http.StatusPaymentRequired, "budget_exceeded", "insufficient_quota"
	case status == http.StatusTooManyRequests:
		return http.StatusTooManyRequests, "rate_limit_error", code
	case status == http.StatusUnauthorized:
		return http.StatusUnauthorized, orDefault(errType, "authentication_error"), code
	case status == http.StatusForbidden:
		return http.StatusForbidden, orDefault(errType, "permission_error"), code
	case status == http.StatusServiceUnavailable:
		return http.StatusServiceUnavailable, orDefault(errType, "api_error"), code
	}
	return status, orDefault(errType, "api_error"), code
}

// isBudgetError recognises budget exhaustion signalled either as HTTP 402 or by
// a budget-shaped type/code on a 4xx.
func isBudgetError(status int, errType, code string) bool {
	if status == http.StatusPaymentRequired {
		return true
	}
	return errType == "budget_exceeded" || code == "budget_exceeded" || code == "insufficient_quota"
}

// writeOpenAIError maps a bifrost error to the OpenAI-shaped error body.
func (h *Handler) writeOpenAIError(w http.ResponseWriter, bErr *schemas.BifrostError) {
	body := openAIErrorBody(bErr)
	status, _, _ := statusAndType(bErr)
	writeJSON(w, status, body)
}

// openAIErrorBody builds the OpenAI-shaped error envelope from a bifrost error
// (used both for unary responses and mid-stream error frames).
func openAIErrorBody(bErr *schemas.BifrostError) openAIError {
	_, errType, code := statusAndType(bErr)
	message := ""
	if bErr.Error != nil {
		message = bErr.Error.Message
	}
	return openAIError{Error: openAIErrorFields{Message: message, Type: errType, Code: code}}
}

// writeAnthropicError maps a bifrost error to the Anthropic-shaped error body
// (used by the Anthropic dialect's unary and pre-stream error paths).
func (h *Handler) writeAnthropicError(w http.ResponseWriter, bErr *schemas.BifrostError) {
	status, _, _ := statusAndType(bErr)
	writeJSON(w, status, anthropic.ToAnthropicChatCompletionError(bErr))
}

// orDefault returns s if non-empty, else def.
func orDefault(s, def string) string {
	if s != "" {
		return s
	}
	return def
}

// canonicalLower lowercases a header key for prefix matching.
func canonicalLower(s string) string { return strings.ToLower(s) }

// hasPrefix reports whether s starts with prefix.
func hasPrefix(s, prefix string) bool { return strings.HasPrefix(s, prefix) }
