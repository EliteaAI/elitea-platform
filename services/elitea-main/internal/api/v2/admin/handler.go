package admin

import (
	"encoding/json"
	"net/http"
	"runtime"
	"sort"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type Handler struct {
	pool     *pgxpool.Pool
	resolver auth.PermissionResolver
}

// Option configures a Handler at construction time.
type Option func(*Handler)

// WithPermissionResolver supplies the resolver the WRITE handlers in users.go
// use for their own, finer-grained checks — specifically the `super_admin`
// escalation guard, which the route-level middleware cannot express because it
// depends on the request body and on the TARGET user's current roles.
//
// Route middleware still gates every write on `admin.auth.users`; this resolver
// is an ADDITIONAL server-side check, never a replacement for it. Fail-closed:
// when it is nil, the escalation-sensitive branches answer 403 rather than
// proceeding unchecked.
func WithPermissionResolver(resolver auth.PermissionResolver) Option {
	return func(h *Handler) { h.resolver = resolver }
}

func NewHandler(pool *pgxpool.Pool, options ...Option) *Handler {
	handler := &Handler{pool: pool}
	for _, option := range options {
		option(handler)
	}
	return handler
}

func (h *Handler) SystemInfo(w http.ResponseWriter, _ *http.Request) {
	info := map[string]any{
		"version":    "2.0.0",
		"build":      "elitea-main-go",
		"go_version": runtime.Version(),
		"plugins": map[string]any{
			"elitea_core": map[string]any{"status": "active", "version": "2.0.0"},
			"auth":        map[string]any{"status": "active", "version": "2.0.0"},
		},
	}
	writeJSON(w, http.StatusOK, info)
}

func (h *Handler) ResourcesConfig(w http.ResponseWriter, _ *http.Request) {
	config := map[string]any{
		"max_file_size":        52428800,
		"max_upload_files":     10,
		"allowed_extensions":   []string{"pdf", "txt", "md", "json", "csv", "docx", "xlsx"},
		"max_context_length":   128000,
		"max_output_tokens":    4096,
		"streaming_enabled":    true,
		"attachments_enabled":  true,
		"artifacts_enabled":    true,
		"mcp_enabled":          true,
		"canvas_enabled":       true,
		"voice_enabled":        false,
		"image_gen_enabled":    false,
		"realtime_enabled":     true,
		"max_participants":     10,
		"max_conversations":    100,
		"max_messages_per_day": 1000,
	}
	writeJSON(w, http.StatusOK, config)
}

func (h *Handler) AdminPermissions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	mode := chi.URLParam(r, "mode")

	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}

	rows, err := h.pool.Query(ctx,
		`SELECT r.id, r.name,
		        COALESCE(array_agg(rp.permission ORDER BY rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}')
		 FROM auth_core__role r
		 LEFT JOIN auth_core__role_permission rp ON rp.role_id = r.id
		 WHERE r.mode = $1
		 GROUP BY r.id, r.name
		 ORDER BY r.id`, mode)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	defer rows.Close()

	// Build role → permission set mapping
	type roleData struct {
		name  string
		perms map[string]bool
	}
	var roles []roleData
	allPerms := make(map[string]bool)

	for rows.Next() {
		var id int
		var name string
		var permissions []string
		if err := rows.Scan(&id, &name, &permissions); err != nil {
			continue
		}
		permSet := make(map[string]bool, len(permissions))
		for _, p := range permissions {
			permSet[p] = true
			allPerms[p] = true
		}
		roles = append(roles, roleData{name: name, perms: permSet})
	}

	// Invert: one row per permission with boolean flags per role
	permNames := make([]string, 0, len(allPerms))
	for p := range allPerms {
		permNames = append(permNames, p)
	}
	sort.Strings(permNames)

	items := make([]map[string]any, 0, len(permNames))
	for _, perm := range permNames {
		row := map[string]any{"name": perm}
		for _, role := range roles {
			row[role.name] = role.perms[perm]
		}
		items = append(items, row)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"rows":  items,
		"total": len(items),
	})
}

func (h *Handler) Projects(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	limit, offset := paginationParams(r)

	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
		return
	}

	var total int
	err := h.pool.QueryRow(ctx, `SELECT COUNT(*) FROM centry.project`).Scan(&total)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
		return
	}

	rows, err := h.pool.Query(ctx,
		`SELECT id, name, COALESCE(owner_id, 0), COALESCE(suspended, false)
		 FROM centry.project
		 ORDER BY id
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": total})
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, ownerID int
		var name string
		var suspended bool
		if err := rows.Scan(&id, &name, &ownerID, &suspended); err != nil {
			continue
		}
		items = append(items, map[string]any{
			"id":        id,
			"name":      name,
			"owner_id":  ownerID,
			"suspended": suspended,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"rows":  items,
		"total": total,
	})
}

func (h *Handler) PluginConfigSchemas(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"sections":                     configSections(),
		"can_view_service_descriptors": true,
	})
}

func (h *Handler) PluginConfigValues(w http.ResponseWriter, r *http.Request) {
	values := make(map[string]any)
	for _, section := range configSections() {
		fields, _ := section["fields"].([]map[string]any)
		for _, f := range fields {
			key, _ := f["key"].(string)
			if key == "" {
				continue
			}
			if def, ok := f["default"]; ok {
				values[key] = def
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": values})
}

func (h *Handler) PluginConfigValuesSave(w http.ResponseWriter, r *http.Request) {
	// Accept PUT and return success (no-op without real runtime)
	writeJSON(w, http.StatusOK, map[string]any{"values": map[string]any{}, "requires_restart": []any{}})
}

func (h *Handler) PluginConfigRestart(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (h *Handler) RuntimeRemoteConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"config": map[string]any{}})
}

func (h *Handler) RuntimePlugin(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (h *Handler) RuntimePylonLogs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"logs": []any{}})
}

func (h *Handler) PluginConfigSuggestions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, []string{})
}

func (h *Handler) ModerationStatuses(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"rows":  []any{},
		"total": 0,
	})
}

func (h *Handler) Maintenance(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": false,
		"message": "",
	})
}

func (h *Handler) RuntimeRemote(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"remotes": []any{},
	})
}

func (h *Handler) Tasks(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"rows":  []any{},
		"total": 0,
	})
}

func (h *Handler) ActiveTasks(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"lines": []any{},
	})
}

func (h *Handler) ProjectSuspend(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	var body struct {
		Suspended bool `json:"suspended"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if h.pool != nil {
		if _, err := h.pool.Exec(r.Context(), `UPDATE centry.project SET suspended = $1 WHERE id = $2`, body.Suspended, projectID); err != nil {
			http.Error(w, `{"error":"failed to update project"}`, http.StatusInternalServerError)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) ModerationStatusSingle(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"rows":  []any{},
		"total": 0,
	})
}

func paginationParams(r *http.Request) (limit, offset int) {
	limit = 20
	offset = 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = v
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}
	return
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
