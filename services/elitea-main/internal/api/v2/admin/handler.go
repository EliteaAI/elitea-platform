package admin

import (
	"encoding/json"
	"net/http"
	"runtime"
	"strconv"

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

// Projects and ProjectSuspend live in projects.go (unit A14).

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

// `ModerationStatuses` and `ModerationStatusSingle` used to sit here: two copies
// of a `_ *http.Request` stub answering a fixed empty page, one mounted ungated
// on `/admin/moderation_statuses/{mode}` and the other mounted on no route at
// all. Unit A14 replaces them with a real read and a real write over
// `centry.moderation_state` — see internal/api/v2/moderation/requests.go.

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

// arbiterTaskNodeUnavailable is what `/admin/tasks` and `/admin/active_tasks`
// answer, and why. Both surfaces are pure Pylon runtime introspection: pylon's
// handlers reach into `self.module.context.module_manager.modules[…].task_node`
// and read its in-process `global_task_state` / `global_pool_state`, then start
// and stop tasks through the Arbiter (legacy/plugins/admin/api/v2/tasks.py and
// active_tasks.py). There is no such registry in this service and there is not
// meant to be one: AGENTS.md's architecture boundaries name "Pylon plugin
// loading" and "Arbiter pickle payloads" as things the target architecture does
// NOT preserve.
//
// Until unit A14 both answered 200 with an empty collection. That is the worse
// failure: "no maintenance tasks are running" and "this deployment cannot see
// whether any are running" render identically, and an operator reading the
// former during an incident concludes the system is idle. `ActiveTasks` did not
// even return the shape its client reads (`{"lines": []}` against a client
// expecting `{"nodes": […]}`), so the emptiness was structural.
//
// 501 with a reason is the honest answer, and it is what the ported admin page
// renders as an unavailable tab rather than as an empty list.
const arbiterTaskNodeUnavailable = "admin task nodes are a Pylon/Arbiter runtime surface with no equivalent in " +
	"this service; see AGENTS.md architecture boundaries"

func (h *Handler) Tasks(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": arbiterTaskNodeUnavailable})
}

func (h *Handler) ActiveTasks(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": arbiterTaskNodeUnavailable})
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
