package admin

import (
	"encoding/json"
	"net/http"
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

// systemInfoUnavailable is what `/admin/system_info/{mode}` and its ungated
// `/admin/system_info/prompt_lib` sibling answer, and why.
//
// pylon's `system_info` reports the versions of six NAMED plugins —
// elitea_core, admin, notifications, configurations, sdk_plugin and
// indexer_worker — read out of `self.module.remote_runtimes`, the registry of
// pylons that announced themselves on the Arbiter bus in the last 60 seconds
// (legacy/plugins/admin/api/v2/system_info.py). It is a FLEET inventory: the
// answer names other processes, not the process that serves the request.
//
// That is the same registry `RuntimeRemote` above reads, and `RuntimeRemote`
// already answers 501 for the same reason. AGENTS.md names Pylon plugin loading
// and Arbiter transport as things the target architecture does not preserve, so
// this service loads no plugins and has no fleet to ask.
//
// Until this change the handler answered 200 with a HARDCODED map: `elitea_core`
// and `auth`, both "active" at version "2.0.0", under a top-level `version`
// "2.0.0" and a `build` "elitea-main-go". Every one of those values was invented.
// `auth` is not even one of the six names pylon reports. The shape was wrong as
// well: pylon returns `plugins` as an ARRAY of `{name, version}`, and both
// clients index it as an array, so the fabricated map rendered as nothing. That
// is luck, not safety — the next person to correct the shape would have made an
// admin screen start to display invented version numbers, which an operator uses
// to decide whether a fix is deployed (#219).
//
// # The three answers that were rejected
//
// An EMPTY list. `{"plugins": []}` reads as "this deployment runs no plugins",
// which is a different statement from "this platform has no plugin concept". The
// `Tasks` and `RuntimeRemote` comments in this file condemn exactly that
// conflation.
//
// The RUNNING BINARY instead. Both clients render plain `name: version` rows, so
// the shape would fit, but this service has no version to read. No `-ldflags -X`
// exists in services/elitea-main/Containerfile, .github/workflows/ci-go.yml or
// docker-bake.hcl; the Containerfile declares `ARG VERSION=dev` and never uses
// it; and the build copies `services/elitea-main/` without a `.git` directory, so
// `debug.ReadBuildInfo` reports `Main.Version` as "(devel)" and records no
// `vcs.revision`. Reporting "(devel)" to an operator who asks which build is
// deployed is the same failure in new clothes. Build-version plumbing is a
// separate change, and this route can report a real version once it exists.
//
// REMOVING the field. A shipped screen renders it, so it cannot simply vanish.
//
// # What the clients do with a 501
//
// apps/elitea-ui reads `GET /admin/system_info/prompt_lib` and holds
// `systemInfo?.plugins ?? []`, so the Help Center version tooltip stays closed —
// the state it is in today. The "Version: X (date)" label beside it comes from
// `/admin/plugin_config_values/prompt_lib/resources`, which is real and
// administrator-owned, so the bar keeps its true content. apps/elitea-web does
// not call this route at all; its `useResourcesConfig` returns an empty plugin
// list on purpose. The legacy admin_ui Information card reads
// `/admin/system_info/administration` the same defensive way and simply lists no
// extra rows.
const systemInfoUnavailable = "plugin version reporting reads the Pylon fleet's Arbiter runtime announcements, " +
	"which have no equivalent in this service; see AGENTS.md architecture boundaries"

func (h *Handler) SystemInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": systemInfoUnavailable})
}

// ResourcesConfig, PluginConfigValues and PluginConfigValuesSave are implemented
// in config_values.go (unit A14). All three were stubs of the three shapes this
// unit exists to remove:
//
//   - `ResourcesConfig` — the route the Help Center calls — answered with chat
//     and upload limits (`max_file_size`, `max_context_length`, …) under no
//     `values` wrapper. It had a route, it returned 200, and it answered a
//     different question than the page asked. Issue #26 records the symptom:
//     every Help Center card renders "No links configured".
//   - `PluginConfigValues` returned the schema's DEFAULTS for EVERY section at
//     once, ignoring the `{plugin}` segment entirely.
//   - `PluginConfigValuesSave` never read the request body.

// Projects and ProjectSuspend live in projects.go (unit A14).

func (h *Handler) PluginConfigSchemas(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"sections": configSections(),
		// Whether the caller may VIEW the descriptors page, which is a different
		// question from whether this section can edit them (it cannot — see
		// serviceDescriptorsSection).
		"can_view_service_descriptors": true,
	})
}

// pylonRuntimeUnavailable is what the five Pylon-runtime endpoints behind the
// Configuration page's Advanced section answer, and why.
//
// Each of them drives a live Pylon: `plugin_config_restart` fires a reload or a
// process restart onto the Arbiter bus; `runtime_remote` lists the plugins every
// pylon announced in the last 60 seconds; `runtime_remote_config` reads and
// writes a plugin's raw YAML; `runtime_plugin` resolves and installs plugin
// versions from a repository; `runtime_pylons` tails a pylon's in-memory log
// buffer (legacy/plugins/admin/api/v2/*.py). AGENTS.md names Pylon plugin
// loading and Arbiter transport as things the target architecture does not
// preserve, so there is nothing to point these at.
//
// Until this unit all five answered 200: `{"status":"ok"}` for the two that act,
// `{"remotes":[]}`/`{"logs":[]}`/`{"config":{}}` for the three that read. That is
// the failure the `Tasks` comment below already condemns, twice over — a restart
// signal that reports success and does nothing, and an empty plugin list that
// reads as "this pylon has no plugins" rather than "this platform cannot see
// any". `runtime_remote` did not even return the shape its client reads
// (`{"remotes": …}` against a client indexing `data.rows`), so the Advanced
// table was structurally empty as well.
const pylonRuntimeUnavailable = "pylon runtime administration (plugin reload, remote plugin config, plugin " +
	"updates and pylon logs) has no equivalent in this service; see AGENTS.md architecture boundaries"

func (h *Handler) PluginConfigRestart(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": pylonRuntimeUnavailable})
}

func (h *Handler) RuntimeRemoteConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": pylonRuntimeUnavailable})
}

func (h *Handler) RuntimePlugin(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": pylonRuntimeUnavailable})
}

func (h *Handler) RuntimePylonLogs(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": pylonRuntimeUnavailable})
}

func (h *Handler) RuntimeRemote(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": pylonRuntimeUnavailable})
}

// PluginConfigSuggestions answered `[]` — a BARE ARRAY, where every client reads
// `data.values` and `data.labels` (admin_ui's `SchemaField.jsx`). So the field
// that asked for suggestions got `undefined`, not an empty list, on top of the
// list being empty.
//
// The sources pylon serves are `toolkit_names` and `toolkit_tools` (read out of
// the elitea_core plugin's in-process toolkit registry) and `projects`. The
// first two have no source of truth in this service. Rather than answer an empty
// list for a source this platform cannot enumerate, it says so — and the only
// sections whose fields declare an `enum_source` are unavailable anyway, so no
// rendered control depends on this today.
func (h *Handler) PluginConfigSuggestions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{
		"error": "configuration value suggestions are sourced from the Pylon toolkit registry, " +
			"which has no equivalent in this service",
	})
}

// `ModerationStatuses` and `ModerationStatusSingle` used to sit here: two copies
// of a `_ *http.Request` stub answering a fixed empty page, one mounted ungated
// on `/admin/moderation_statuses/{mode}` and the other mounted on no route at
// all. Unit A14 replaces them with a real read and a real write over
// `centry.moderation_state` — see internal/api/v2/moderation/requests.go.

// Maintenance was registered on BOTH verbs pointing at the same handler, so the
// PUT discarded its body and the GET reported `enabled: false` unconditionally —
// a maintenance switch that always read "off" and never turned on.
//
// pylon's maintenance mode is a request hook installed on the bootstrap plugin's
// persisted state, serving a 503 splash to every user whose administration-mode
// roles do not include admin (legacy/plugins/bootstrap/tools/splash.py). Nothing
// in this service installs such a hook. Reporting "maintenance is off" when the
// deployment cannot enter maintenance at all is the same conflation `Tasks` was
// corrected for.
func (h *Handler) Maintenance(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": maintenanceSplashUnavailable})
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
