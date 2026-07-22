package llmproxy

import (
	"net/http"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func bErr(status int, errType, code, msg string) *schemas.BifrostError {
	e := &schemas.BifrostError{Error: &schemas.ErrorField{Message: msg}}
	if status != 0 {
		e.StatusCode = intPtr(status)
	}
	if errType != "" {
		e.Error.Type = strPtr(errType)
	}
	if code != "" {
		e.Error.Code = strPtr(code)
	}
	return e
}

func TestStatusAndType(t *testing.T) {
	tests := []struct {
		name       string
		in         *schemas.BifrostError
		wantStatus int
		wantType   string
		wantCode   string
	}{
		{"budget by 402", bErr(http.StatusPaymentRequired, "", "", "over budget"), http.StatusPaymentRequired, "budget_exceeded", "insufficient_quota"},
		{"budget by code on 400", bErr(http.StatusBadRequest, "", "budget_exceeded", "x"), http.StatusPaymentRequired, "budget_exceeded", "insufficient_quota"},
		{"budget by insufficient_quota code", bErr(http.StatusBadRequest, "", "insufficient_quota", "x"), http.StatusPaymentRequired, "budget_exceeded", "insufficient_quota"},
		{"rate limit", bErr(http.StatusTooManyRequests, "", "slow", "x"), http.StatusTooManyRequests, "rate_limit_error", "slow"},
		{"auth", bErr(http.StatusUnauthorized, "", "", "x"), http.StatusUnauthorized, "authentication_error", ""},
		{"auth keeps provider type", bErr(http.StatusUnauthorized, "invalid_api_key", "", "x"), http.StatusUnauthorized, "invalid_api_key", ""},
		{"permission", bErr(http.StatusForbidden, "", "", "x"), http.StatusForbidden, "permission_error", ""},
		{"infra 503", bErr(http.StatusServiceUnavailable, "", "", "x"), http.StatusServiceUnavailable, "api_error", ""},
		{"passthrough 400", bErr(http.StatusBadRequest, "invalid_request_error", "", "x"), http.StatusBadRequest, "invalid_request_error", ""},
		{"no status defaults 500", bErr(0, "", "", "x"), http.StatusInternalServerError, "api_error", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, errType, code := statusAndType(tt.in)
			if status != tt.wantStatus || errType != tt.wantType || code != tt.wantCode {
				t.Errorf("statusAndType = (%d,%q,%q), want (%d,%q,%q)",
					status, errType, code, tt.wantStatus, tt.wantType, tt.wantCode)
			}
		})
	}
}

func TestIsBudgetError(t *testing.T) {
	if !isBudgetError(http.StatusPaymentRequired, "", "") {
		t.Error("402 should be a budget error")
	}
	if !isBudgetError(http.StatusBadRequest, "budget_exceeded", "") {
		t.Error("budget_exceeded type should be a budget error")
	}
	if isBudgetError(http.StatusBadRequest, "", "") {
		t.Error("plain 400 should not be a budget error")
	}
}

func TestOpenAIErrorBody(t *testing.T) {
	body := openAIErrorBody(bErr(http.StatusTooManyRequests, "", "", "slow down"))
	if body.Error.Type != "rate_limit_error" {
		t.Errorf("type = %q, want rate_limit_error", body.Error.Type)
	}
	if body.Error.Message != "slow down" {
		t.Errorf("message = %q, want 'slow down'", body.Error.Message)
	}
}

func TestOrDefault(t *testing.T) {
	if orDefault("", "def") != "def" {
		t.Error("empty string should return default")
	}
	if orDefault("x", "def") != "x" {
		t.Error("non-empty string should be returned as-is")
	}
}

func TestIsStream(t *testing.T) {
	if isStream(nil) {
		t.Error("nil should be false")
	}
	f := false
	if isStream(&f) {
		t.Error("*false should be false")
	}
	tr := true
	if !isStream(&tr) {
		t.Error("*true should be true")
	}
}

func TestHeaderPrefixHelpers(t *testing.T) {
	if canonicalLower("X-LiteLLM-Foo") != "x-litellm-foo" {
		t.Error("canonicalLower should lowercase")
	}
	if !hasPrefix("x-litellm-foo", "x-litellm-") {
		t.Error("hasPrefix should match")
	}
	if hasPrefix("server", "x-litellm-") {
		t.Error("hasPrefix should not match unrelated key")
	}
}

func TestErrHelpers(t *testing.T) {
	if errRequired("model").Error() != "model field is required" {
		t.Errorf("errRequired = %q", errRequired("model").Error())
	}
	if wrapInvalid("n").Error() != "invalid n value" {
		t.Errorf("wrapInvalid = %q", wrapInvalid("n").Error())
	}
}
