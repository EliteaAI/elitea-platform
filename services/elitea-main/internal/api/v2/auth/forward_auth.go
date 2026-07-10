package auth

import (
	"encoding/base64"
	"net/http"
	"strings"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
)

// ForwardAuthHandler implements Traefik's forward-auth protocol.
// Traefik sends the original request headers; this handler validates
// credentials and responds 200 + auth headers on success, or 401/403 on failure.
type ForwardAuthHandler struct {
	authClient *authsvc.Client
	validator  apimw.TokenValidator
}

func NewForwardAuthHandler(client *authsvc.Client, validator apimw.TokenValidator) *ForwardAuthHandler {
	return &ForwardAuthHandler{authClient: client, validator: validator}
}

func (h *ForwardAuthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Traefik sends the original request's headers in the forwarded request.
	// We validate Authorization (Bearer/Basic) or X-API-Key.

	// Try X-API-Key first
	if apiKey := r.Header.Get("X-API-Key"); apiKey != "" {
		user, err := h.validate(r, apiKey)
		if err != nil {
			http.Error(w, "Access Denied", http.StatusForbidden)
			return
		}
		h.writeSuccess(w, "token", user.ID, user.Email)
		return
	}

	// Try Authorization header
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		token, ok := extractToken(authHeader)
		if !ok {
			http.Error(w, "Access Denied", http.StatusForbidden)
			return
		}
		user, err := h.validate(r, token)
		if err != nil {
			http.Error(w, "Access Denied", http.StatusForbidden)
			return
		}
		h.writeSuccess(w, "token", user.ID, user.Email)
		return
	}

	// No credentials provided
	http.Error(w, "Access Denied", http.StatusForbidden)
}

func (h *ForwardAuthHandler) validate(r *http.Request, token string) (struct{ ID, Email string }, error) {
	type result struct{ ID, Email string }

	ctx := r.Context()

	if h.validator != nil {
		user, err := h.validator.ValidateToken(ctx, token)
		if err != nil {
			return result{}, err
		}
		return result{ID: user.ID, Email: user.Email}, nil
	}

	user, err := h.authClient.ValidateToken(ctx, token)
	if err != nil {
		return result{}, err
	}
	return result{ID: user.ID, Email: user.Email}, nil
}

func (h *ForwardAuthHandler) writeSuccess(w http.ResponseWriter, authType, authID, authRef string) {
	if authRef == "" {
		authRef = "-"
	}
	w.Header().Set("X-Auth-Type", authType)
	w.Header().Set("X-Auth-ID", authID)
	w.Header().Set("X-Auth-Reference", authRef)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func extractToken(authHeader string) (string, bool) {
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer "), true
	}
	if strings.HasPrefix(authHeader, "Basic ") {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(authHeader, "Basic "))
		if err != nil {
			return "", false
		}
		parts := strings.SplitN(string(decoded), ":", 2)
		return parts[0], true
	}
	return "", false
}
