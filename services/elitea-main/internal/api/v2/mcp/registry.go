package mcp

// `tools_list` and `tools_call` — pylon `elitea_core/api/v2/tools_list.py` and
// `tools_call.py`.
//
//	GET  /api/v2/elitea_core/tools_list/default/{projectID}
//	POST /api/v2/elitea_core/tools_call/default/{projectID}
//
// Both answer 501 with ToolRegistryUnavailableReason. This file is why that is
// the honest answer rather than a shortcut, and why an empty `[]` would be
// worse.
//
// # What these two endpoints actually are
//
// They are NOT this platform listing its own tools — that is the MCP server in
// server.go, and it works. They are the REVERSE direction: a listing of MCP
// servers that an Elitea MCP CLIENT has registered INTO a project, and a way to
// invoke a tool on one of them.
//
// The registration path is socket.io, and the store is process memory:
//
//   - `elitea_core/sio/mcp.py` handles the `mcp_connect` event. A client that
//     runs MCP servers locally connects a websocket, declares its toolkit
//     configs, and each one is filed under the project by
//     `ServersStorage.add_server`, keyed to the socket's `sid`.
//   - `utils/mcp_servers_storage.py` IS the store — two plain Python dicts on
//     the plugin module object, `project_id → name → McpServer` and
//     `sid → project_id`. Nothing is written to a database. A scheduled RPC,
//     `mcp_servers_handler`, walks it every interval and drops entries whose
//     socket has gone away.
//   - `tools_list` returns `get_registered_servers_private_and_current(...)`,
//     the union of that dict for the caller's personal project and the current
//     one.
//   - `tools_call` looks the named server up in the same dict and dispatches
//     with `context.sio.call(SioEvents.mcp_tools_call, …, to=server.sio_sid)` —
//     a blocking round trip back down the originating websocket, waiting on
//     that client to run the tool and answer.
//
// # Why there is nothing to port
//
// The store has no schema. It has no migration, no table, and no row anywhere
// in this stack — searching for one is the mistake this comment is here to
// prevent. Its entire content is "which websockets are currently attached, and
// what did they say they could do", which is a fact about a running pylon
// process, not about the product's data.
//
// And the dispatch half is a socket.io server call. AGENTS.md's transport rules
// do not admit one, and this service has never run a socket.io server; the
// realtime surface it does have is SSE (issues 93 and 152). Reproducing
// `tools_call` would mean standing up the exact transport the replatform
// removed, for the sole purpose of talking to clients that connect to pylon.
//
// # Why not 200 with an empty list
//
// Because `[]` is a factual claim: "no MCP client has registered a server for
// this project". This service cannot know that. The clients register with
// pylon, over a socket this process does not accept, and the answer this
// process can honestly give about them is "I am not the component that knows".
// A caller reading `[]` would conclude their client had failed to connect and
// go and debug the client. Issue 128 is the file of exactly this defect class:
// endpoints that answered 200 while nothing behind them was wired, and passed
// every status-code test for as long as they existed.

import "net/http"

// ToolRegistryUnavailableReason is the single sentence both endpoints give.
//
// Exported so the acceptance tests assert the endpoint's stated reason rather
// than just its status code — a 501 with a different body would be a different
// refusal, and pinning the reason is what keeps a later edit from quietly
// turning it into a stub.
const ToolRegistryUnavailableReason = "tools_list and tools_call report MCP servers that an Elitea MCP CLIENT " +
	"registers into a project over socket.io: pylon files them in an in-process dict keyed by the client's socket " +
	"id, and tools_call dispatches back down that same socket and waits for the client to run the tool. There is " +
	"no table behind that dict, in pylon or here, and this service runs no socket.io server, so there are no " +
	"registrations to list and no socket to dispatch on. An empty list is not the answer either: it would assert " +
	"that no client is connected, which this service has no way to know. To expose THIS platform's agents and " +
	"toolkits as MCP tools, use the MCP server at /app/{project_id}/mcp."

// ToolsList serves `GET /elitea_core/tools_list/default/{projectID}`.
func (h *Handler) ToolsList(w http.ResponseWriter, r *http.Request) {
	// Gated on the master switch before the refusal, like every other route in
	// this package: which subsystems a deployment runs is itself information
	// about it, and a deployment that switched MCP off should not be
	// distinguishable from one that did not by the shape of the error.
	if !h.requireMCPEnabled(w, r) {
		return
	}
	writeToolRegistryRefusal(w)
}

// ToolsCall serves `POST /elitea_core/tools_call/default/{projectID}`.
//
// The body is not read. pylon validates it against `McpToolCallPostBody`
// (server, tool_call_id, tool_timeout_sec, params) before looking the server
// up, but a 400 for a malformed body would imply that a well-formed one would
// be dispatched somewhere, and none is.
func (h *Handler) ToolsCall(w http.ResponseWriter, r *http.Request) {
	if !h.requireMCPEnabled(w, r) {
		return
	}
	writeToolRegistryRefusal(w)
}

// writeToolRegistryRefusal is one function so a later edit cannot make the read
// and the write disagree — the listing saying "unavailable" while the call
// quietly returns 200 is precisely the state this file exists to prevent.
func writeToolRegistryRefusal(w http.ResponseWriter) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": ToolRegistryUnavailableReason})
}
