// Package mcp is the MCP SERVER surface — issue 252. It is the half of Elitea's
// Model Context Protocol story that had no Go counterpart at all: the platform
// speaking MCP *to* external clients, so an agent host (Claude Desktop, Cursor,
// the MCP Inspector, any SDK client) can list and drive a project's agents and
// toolkits as MCP tools.
//
// What already existed here is the CLIENT side and its plumbing —
// `mcp_oauth_proxy`, `mcp_dcr_proxy`, `mcp_sync_tools` in
// `internal/api/v2/eliteacore/handler.go`, the `mcp_enabled` platform flag, the
// `?mcp=true` toolkit-type filter. None of those answer an MCP protocol
// message. A repo-wide grep for `tools/list`, `tools/call` or `/mcp` server
// handling found nothing before this package.
//
// # Legacy module → Go route
//
// Transport (pylon `routes/mcp_sse.py`, served under the app blueprint):
//
//	GET|POST /<pid>/mcp                    → GET|POST /app/{projectID}/mcp
//	GET|POST /<pid>/mcp/<openapi_tag>      → GET|POST /app/{projectID}/mcp/{category}
//	GET|POST /<pid>/mcp/<entity>/<ver_id>  → GET|POST /app/{projectID}/mcp/{entity}/{entityVersionID}
//	GET      /<pid>/sse + POST /<pid>/messages → NOT PORTED, see "The SSE pair" below
//
// REST (pylon `api/v2/`), under /api/v2/elitea_core:
//
//	tools_list              → GET  /tools_list/{projectID}
//	                          GET  /tools_list/default/{projectID}
//	tools_call              → POST /tools_call/default/{projectID}
//	internal_mcp_pat_status → GET  /internal_mcp_pat_status/prompt_lib/{projectID}/{toolkitType}
//
// # What serves real data and what refuses
//
// The three answers this package can give are kept strictly apart, because the
// failure this repo keeps rediscovering (issue 128) is a route that answers 200
// while nothing behind it is wired:
//
//   - REAL. `initialize`, `tools/list` in all three scopes,
//     `internal_mcp_pat_status`, and the REST `tools_list`. The MCP protocol
//     listing is assembled from this project's own rows — agents whose version
//     carries the `mcp` tag, and toolkits flagged
//     `meta.mcp_options.available_by_mcp` — by catalog.go. The REST `tools_list`
//     reads the durable MCP server store (registry.go, issue 335). Nothing
//     about either is hardcoded or invented.
//   - HONEST PROTOCOL ERROR. `tools/call`. Listing a tool and running it are
//     different capabilities: running an agent needs the agent runtime, and
//     running a toolkit tool needs the Python worker's toolkit dispatch.
//     Neither is reachable from this service yet, so a call returns a
//     CallToolResult with `isError: true` naming exactly what is missing (see
//     server.go). It never returns an empty successful result, which is what
//     an agent host would read as "the tool ran and produced nothing".
//   - HONEST 501. `tools_call`, the one remaining REST refusal. It dispatches a
//     tool invocation to the server that publishes the tool. This service does
//     not store that server's credentials, and it runs no socket.io server to
//     reach a client-hosted one. See registry.go for why a remote MCP toolkit
//     loses nothing by this.
//
// # The `api` tool category is deliberately not ported
//
// pylon's listing has a third source besides agents and toolkits:
// `openapi_registry.get_mcp_api_tools()`, which republishes pylon's own REST
// endpoints as MCP tools — 90 endpoints across seven plugins opt in with
// `mcp_tool=True`, and `McpApiToolExecutor` runs them by re-entering the Flask
// WSGI app with the caller's cookies and headers.
//
// That source is not reproduced here, for two reasons that are not "no time":
//
//  1. The opt-in list does not exist in this stack. Which REST operations an
//     external MCP client may drive is a security decision made one endpoint at
//     a time; `api/openapi/v2.yaml` carries no such marker, and inferring one
//     from "every operation in the document" would publish the admin surface to
//     any PAT holder. Several of the pylon opt-ins (the configurations and
//     projects plugins) have no Go REST counterpart to mark in the first place.
//  2. Execution would be a self-dispatch bridge — a request re-entered into
//     this service's own router with forwarded credentials — with its own
//     recursion, auth-forwarding and middleware-re-entry design. That is a
//     surface to specify, not to improvise inside a parity port.
//
// So the category vocabulary this server accepts is the two categories it can
// actually serve, `applications` and `toolkits`; anything else is a 400 that
// names the valid set, which is how pylon answers an unknown tag too. See
// scope.go.
//
// # The SSE pair is dropped, not deferred
//
// pylon also serves the pre-2025 MCP transport: `GET /<pid>/sse` opens an event
// stream that emits an `endpoint` event, and the client then POSTs each message
// to `/<pid>/messages?session_id=…`. That pair is deprecated in the MCP
// specification in favour of streamable HTTP, which is what every current
// client speaks and what this package implements. Issue 252 P4 asks for a
// decision rather than code: it is DROPPED, superseded by streamable HTTP. It
// gets ported only if a named client turns up that cannot speak the current
// transport, and that client's name is what would justify the session store the
// pair needs (pylon keeps one `SseSession` per connection in process memory,
// which is also why the pair cannot survive more than one replica).
//
// # Statelessness
//
// The MCP specification lets a server operate without sessions, and this one
// does: no `Mcp-Session-Id` is issued, so no client is ever required to send
// one back, and no request depends on a predecessor. pylon's streamable-HTTP
// path is effectively the same — `create_http_session` builds a throwaway
// `HttpSession` per request — but it reaches that state by accident rather than
// by contract. Being stateless by contract is what lets this run behind more
// than one replica.
package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/mcpregistry"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/platformconfig"
)

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// errNoPool is returned instead of dereferencing a nil pool. A handler
// constructed without a database is a composition fault, and the callers turn
// it into a 503 rather than a panic that takes the process down.
var errNoPool = errors.New("mcp: no database pool configured")

// Handler serves both the REST endpoints and the MCP protocol endpoints.
//
// One handler rather than two because both halves answer to the same master
// switch and the same tenant scoping, and a second type would only make it
// possible for the two to disagree about them.
type Handler struct {
	pool *pgxpool.Pool
	// source is the tool catalog. Swappable so the protocol handling can be
	// tested without a database; production always gets postgresToolSource.
	source toolSource
	// registry is the durable store of MCP servers registered into a project.
	// It is what `tools_list` reads (registry.go, issue 335).
	registry *mcpregistry.Store
	// personal resolves the caller's personal project, whose registered servers
	// pylon unions into every listing.
	personal PersonalProjectResolver
}

// PersonalProjectResolver reports a user's personal project id.
//
// Declared here as the narrow interface this package needs, rather than
// importing the middleware package, so the dependency points one way. The
// production implementation is `middleware.DBPersonalProjectResolver`, which
// mirrors pylon's `projects_get_personal_project_id`.
type PersonalProjectResolver interface {
	PersonalProjectID(ctx context.Context, userID string) (int, error)
}

// NewHandler builds the MCP handler.
//
// personal is a required argument rather than an optional setter. A listing
// built without it silently drops the caller's own registered servers, and this
// repository has shipped that failure before: a builder method that no
// composition root called (issue 128). An argument cannot be forgotten.
func NewHandler(pool *pgxpool.Pool, personal PersonalProjectResolver) *Handler {
	handler := &Handler{pool: pool, personal: personal}
	handler.source = postgresToolSource{handler: handler}
	if pool != nil {
		handler.registry = mcpregistry.NewStore(pool)
	}
	return handler
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// mcpEnabled resolves the deployment-wide MCP master switch.
//
// This is the same read `internal/api/v2/eliteacore/platform_flags.go` performs
// for the OAuth/DCR/sync routes, deliberately duplicated as a call to the same
// `platformconfig` section and key rather than re-exported: the flag's own
// description promises it "removes all MCP-related functionality across the
// entire application including API endpoints", and this package publishes the
// largest MCP surface in the service, so it must obey the switch or the promise
// is false.
//
// The failure mode is permissive for the same reason it is there: an
// unreadable configuration store is an operational fault, and resolving it to
// "MCP is disabled" would turn a database hiccup into a platform-wide outage of
// a subsystem nobody switched off.
func (h *Handler) mcpEnabled(ctx context.Context) bool {
	values, err := platformconfig.Load(ctx, h.pool, platformconfig.SectionMCPConfiguration)
	if err != nil {
		return true
	}
	return values.Bool(platformconfig.KeyMCPEnabled, true)
}

// mcpDisabledMessage is pylon's wording, byte for byte
// (`legacy/plugins/elitea_core/routes/mcp_sse.py:_check_mcp_enabled`). Existing
// clients of these paths were written against that sentence.
const mcpDisabledMessage = "MCP exposure is disabled on this deployment"

// requireMCPEnabled gates the REST half. It returns true when the request may
// proceed.
func (h *Handler) requireMCPEnabled(w http.ResponseWriter, r *http.Request) bool {
	if h.mcpEnabled(r.Context()) {
		return true
	}
	writeJSON(w, http.StatusForbidden, map[string]any{"error": mcpDisabledMessage})
	return false
}

// projectSchema turns a URL segment into the tenant schema name.
//
// Every query in this package interpolates the schema with %q, which quotes but
// does not escape, so a segment that is not a plain positive integer must never
// reach one. The router's patterns do not constrain the segment, so the check
// lives here — the same reason `internal/api/v2/skillpublish` keeps its own
// copy.
func projectSchema(raw string) (string, bool) {
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return "", false
	}
	return "p_" + raw, true
}
