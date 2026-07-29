package auth

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type Handler struct {
	permissions     auth.PermissionResolver
	tokens          tokenRepository
	tokenSigningKey []byte
}

type Option func(*Handler)

func WithPermissionResolver(resolver auth.PermissionResolver) Option {
	return func(handler *Handler) {
		handler.permissions = resolver
	}
}

func WithTokenSigningKey(secret string) Option {
	return func(handler *Handler) {
		handler.tokenSigningKey = []byte(secret)
	}
}

func NewHandler(pool *pgxpool.Pool, opts ...Option) *Handler {
	handler := &Handler{}
	if pool != nil {
		handler.tokens = newPostgresTokenRepository(pool)
	}
	for _, opt := range opts {
		opt(handler)
	}
	return handler
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(noStore)
	r.Get("/permissions/prompt_lib/{projectID}", h.PermissionList)
	r.Get("/token/", h.TokenList)
	r.Get("/token/{tokenUUID}", h.TokenGet)
	r.Post("/token/", h.TokenCreate)
	r.Delete("/token/{tokenUUID}", h.TokenDelete)
	return r
}

func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Pragma", "no-cache")
		next.ServeHTTP(w, r)
	})
}

type Permission struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
}

func (h *Handler) PermissionList(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		apierr.Write(w, apierr.Unauthorized("not authenticated"))
		return
	}

	projectID := chi.URLParam(r, "projectID")
	permissions := []string{}
	if h.permissions != nil {
		resolution, err := h.permissions.ResolvePermissions(
			r.Context(),
			user,
			auth.PermissionModeDefault,
			projectID,
		)
		if err == nil {
			permissions = resolution.Permissions
		}
	}

	writeJSON(w, http.StatusOK, permissions)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
