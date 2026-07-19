package auth

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type Handler struct {
	authClient *authsvc.Client
	redis      *goredis.Client
	pool       *pgxpool.Pool
}

func NewHandler(authClient *authsvc.Client, redis *goredis.Client, pool *pgxpool.Pool) *Handler {
	return &Handler{authClient: authClient, redis: redis, pool: pool}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/permissions/prompt_lib/{projectID}", h.PermissionList)
	r.Get("/token/", h.TokenList)
	r.Post("/token/", h.TokenCreate)
	r.Delete("/token/{tokenUUID}", h.TokenDelete)
	return r
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

	// Try to load permissions from DB for this user+project.
	permissions := h.loadUserPermissions(r.Context(), user.ID, projectID)

	if len(permissions) == 0 {
		// Check global role permissions (super_admin, admin via auth_core__role_permission)
		permissions = h.loadGlobalRolePermissions(r.Context(), user.ID)
	}

	if len(permissions) == 0 {
		permissions = h.loadAllProjectPermissions(r.Context(), projectID)
	}

	if len(permissions) == 0 {
		permissions = defaultPermissionNames()
	}

	writeJSON(w, http.StatusOK, permissions)
}

func (h *Handler) loadUserPermissions(ctx context.Context, userID, projectID string) []string {
	if h.pool == nil {
		return nil
	}
	// First try project-specific role permissions
	q := `
		SELECT DISTINCT prp.permission
		FROM auth_core__project_role_permission prp
		JOIN auth_core__project_user_role pur ON pur.role_id = prp.role_id AND pur.project_id = prp.project_id
		WHERE pur.user_id = $1 AND pur.project_id = $2
		ORDER BY prp.permission`
	rows, err := h.pool.Query(ctx, q, userID, projectID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var perms []string
	for rows.Next() {
		var p string
		if rows.Scan(&p) == nil {
			perms = append(perms, p)
		}
	}
	if len(perms) > 0 {
		return perms
	}
	// Fallback: resolve permissions via global role_permission using the project role name
	q2 := `
		SELECT DISTINCT rp.permission
		FROM auth_core__role_permission rp
		JOIN auth_core__role r ON r.id = rp.role_id
		JOIN auth_core__project_role pr ON pr.name = r.name
		JOIN auth_core__project_user_role pur ON pur.role_id = pr.id AND pur.project_id = pr.project_id
		WHERE pur.user_id = $1 AND pur.project_id = $2
		ORDER BY rp.permission`
	rows2, err := h.pool.Query(ctx, q2, userID, projectID)
	if err != nil {
		return nil
	}
	defer rows2.Close()
	for rows2.Next() {
		var p string
		if rows2.Scan(&p) == nil {
			perms = append(perms, p)
		}
	}
	return perms
}

func (h *Handler) loadGlobalRolePermissions(ctx context.Context, userID string) []string {
	if h.pool == nil {
		return nil
	}
	q := `
		SELECT DISTINCT rp.permission
		FROM auth_core__role_permission rp
		JOIN auth_core__user_role ur ON ur.role_id = rp.role_id
		WHERE ur.user_id = $1
		ORDER BY rp.permission`
	rows, err := h.pool.Query(ctx, q, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var perms []string
	for rows.Next() {
		var p string
		if rows.Scan(&p) == nil {
			perms = append(perms, p)
		}
	}
	return perms
}

func (h *Handler) loadAllProjectPermissions(ctx context.Context, projectID string) []string {
	if h.pool == nil {
		return nil
	}
	// Return ALL permissions defined for any role in this project (admin fallback).
	q := `SELECT DISTINCT permission FROM auth_core__project_role_permission WHERE project_id = $1 ORDER BY permission`
	rows, err := h.pool.Query(ctx, q, projectID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var perms []string
	for rows.Next() {
		var p string
		if rows.Scan(&p) == nil {
			perms = append(perms, p)
		}
	}
	if len(perms) > 0 {
		return perms
	}
	// If this project has no permissions at all, grab from any project that does.
	q2 := `SELECT DISTINCT permission FROM auth_core__project_role_permission ORDER BY permission`
	rows2, err := h.pool.Query(ctx, q2)
	if err != nil {
		return nil
	}
	defer rows2.Close()
	for rows2.Next() {
		var p string
		if rows2.Scan(&p) == nil {
			perms = append(perms, p)
		}
	}
	return perms
}

// CorePermissions is called from the elitea_core route to keep backward-compat.
func (h *Handler) CorePermissions(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		apierr.Write(w, apierr.Unauthorized("not authenticated"))
		return
	}
	projectID := chi.URLParam(r, "projectID")

	permissions := h.loadUserPermissions(r.Context(), user.ID, projectID)
	if len(permissions) == 0 {
		permissions = h.loadGlobalRolePermissions(r.Context(), user.ID)
	}
	if len(permissions) == 0 {
		permissions = h.loadAllProjectPermissions(r.Context(), projectID)
	}
	if len(permissions) == 0 {
		permissions = defaultPermissionNames()
	}
	writeJSON(w, http.StatusOK, permissions)
}

type Token struct {
	UUID      string `json:"uuid"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
	Prefix    string `json:"prefix"`
}

func (h *Handler) TokenList(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		apierr.Write(w, apierr.Unauthorized("not authenticated"))
		return
	}

	ctx := r.Context()
	key := "user_tokens:" + user.ID
	val, err := h.redis.Get(ctx, key).Result()
	if err != nil {
		writeJSON(w, http.StatusOK, []Token{})
		return
	}

	var tokens []Token
	if err2 := json.Unmarshal([]byte(val), &tokens); err2 != nil {
		writeJSON(w, http.StatusOK, []Token{})
		return
	}
	writeJSON(w, http.StatusOK, tokens)
}

type tokenCreateRequest struct {
	Name string `json:"name"`
}

func (h *Handler) TokenCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		apierr.Write(w, apierr.Unauthorized("not authenticated"))
		return
	}

	var req tokenCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	token := Token{
		UUID:      generateUUID(),
		Name:      req.Name,
		CreatedAt: nowISO(),
		Prefix:    "elt_",
	}

	ctx := r.Context()
	key := "user_tokens:" + user.ID
	var tokens []Token
	if val, err := h.redis.Get(ctx, key).Result(); err == nil {
		_ = json.Unmarshal([]byte(val), &tokens) // best-effort: start with empty slice on corrupt cache
	}
	tokens = append(tokens, token)
	data, _ := json.Marshal(tokens)
	_ = h.redis.Set(ctx, key, data, 0)

	writeJSON(w, http.StatusCreated, map[string]any{
		"uuid":       token.UUID,
		"name":       token.Name,
		"created_at": token.CreatedAt,
		"token":      "elt_" + token.UUID,
	})
}

func (h *Handler) TokenDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		apierr.Write(w, apierr.Unauthorized("not authenticated"))
		return
	}

	tokenUUID := chi.URLParam(r, "tokenUUID")
	ctx := r.Context()
	key := "user_tokens:" + user.ID

	var tokens []Token
	if val, err := h.redis.Get(ctx, key).Result(); err == nil {
		_ = json.Unmarshal([]byte(val), &tokens) // best-effort: start with empty slice on corrupt cache
	}

	filtered := make([]Token, 0, len(tokens))
	for _, t := range tokens {
		if t.UUID != tokenUUID {
			filtered = append(filtered, t)
		}
	}
	data, _ := json.Marshal(filtered)
	_ = h.redis.Set(ctx, key, data, 0)

	w.WriteHeader(http.StatusNoContent)
}

func defaultPermissionNames() []string {
	return []string{
		"models.create",
		"models.read",
		"models.update",
		"models.delete",
		"prompts.create",
		"prompts.read",
		"prompts.update",
		"prompts.delete",
		"datasources.create",
		"datasources.read",
		"datasources.update",
		"datasources.delete",
		"applications.create",
		"applications.read",
		"applications.update",
		"applications.delete",
		"conversations.create",
		"conversations.read",
		"conversations.update",
		"conversations.delete",
		"settings.read",
		"settings.update",
		"integrations.create",
		"integrations.read",
		"integrations.update",
		"integrations.delete",
		"modes.users",
		"modes.prompt_lib",
		"modes.collections",
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
