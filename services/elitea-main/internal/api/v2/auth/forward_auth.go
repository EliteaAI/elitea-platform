package auth

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	identity "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
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
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	// Traefik sends the original request's headers in the forwarded request.
	// We validate Authorization (Bearer/Basic) or X-API-Key.

	// Try X-API-Key first
	if apiKey := r.Header.Get("X-API-Key"); apiKey != "" {
		user, err := h.validate(r, apiKey)
		if err != nil {
			http.Error(w, "Access Denied", http.StatusForbidden)
			return
		}
		if err := h.writeSuccess(w, user); err != nil {
			http.Error(w, "Access Denied", http.StatusForbidden)
		}
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
		if err := h.writeSuccess(w, user); err != nil {
			http.Error(w, "Access Denied", http.StatusForbidden)
		}
		return
	}

	// No credentials provided
	http.Error(w, "Access Denied", http.StatusForbidden)
}

func (h *ForwardAuthHandler) validate(r *http.Request, token string) (identity.User, error) {
	ctx := r.Context()

	if h.validator != nil {
		user, err := h.validator.ValidateToken(ctx, token)
		if err != nil {
			return identity.User{}, err
		}
		return user, nil
	}
	if h.authClient == nil {
		return identity.User{}, errors.New("auth client is not configured")
	}

	user, err := h.authClient.ValidateToken(ctx, token)
	if err != nil {
		return identity.User{}, err
	}
	return user, nil
}

func (h *ForwardAuthHandler) writeSuccess(w http.ResponseWriter, user identity.User) error {
	// Legacy forward-auth identifies a token by auth_core__token.id. The owner
	// is carried separately so downstream code can cross-check it and never
	// infer ownership from a colliding numeric user ID.
	if user.TokenID == "" || user.UserID == "" {
		return errors.New("validated token identity is incomplete")
	}
	authRef := user.Email
	if authRef == "" {
		authRef = "-"
	}
	w.Header().Set("X-Auth-Type", "token")
	w.Header().Set("X-Auth-ID", user.TokenID)
	w.Header().Set("X-Auth-User-ID", user.UserID)
	w.Header().Set("X-Auth-Reference", authRef)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("OK"))
	return nil
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
