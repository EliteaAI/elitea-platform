package policy

import (
	"encoding/json"
	"net/url"
	"sort"
	"strings"
)

// MCPServersFromRequest extracts the MCP servers a request asks the provider to
// call, from the RAW request body.
//
// It reads the raw bytes rather than the decoded bifrost struct on purpose. The
// gateway decodes into bifrost's request types, and a tool entry of a type
// bifrost does not model is dropped by that decode — so an allowlist built on
// the decoded value would silently permit exactly the servers it could not see.
// The raw body is the only representation that carries everything the caller
// actually sent.
//
// Two wire shapes carry MCP servers today:
//
//	OpenAI Responses:  {"tools":[{"type":"mcp","server_label":"x","server_url":"https://…"}]}
//	Anthropic Messages:{"mcp_servers":[{"type":"url","name":"x","url":"https://…"}]}
//
// Each server is identified by its LABEL when it has one, and by the host of
// its URL otherwise. Both are returned when both are present, because an
// operator may reasonably have allowlisted either, and requiring them to guess
// which spelling the gateway uses would make the control unusable. The result
// is deduplicated and sorted so a refusal message is stable.
//
// A body that does not parse yields nothing. That is not a hole: the handler
// decodes the same bytes immediately afterwards and refuses a malformed body
// with a 400, so nothing dispatches on a body this function could not read.
func MCPServersFromRequest(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil
	}
	seen := map[string]struct{}{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		seen[s] = struct{}{}
	}

	// OpenAI Responses tools[].
	if tools, ok := body["tools"].([]any); ok {
		for _, t := range tools {
			tool, ok := t.(map[string]any)
			if !ok {
				continue
			}
			if !strings.EqualFold(stringField(tool, "type"), "mcp") {
				continue
			}
			add(stringField(tool, "server_label"))
			add(hostOf(stringField(tool, "server_url")))
		}
	}

	// Anthropic Messages mcp_servers[].
	if servers, ok := body["mcp_servers"].([]any); ok {
		for _, s := range servers {
			srv, ok := s.(map[string]any)
			if !ok {
				continue
			}
			add(stringField(srv, "name"))
			add(hostOf(stringField(srv, "url")))
		}
	}

	if len(seen) == 0 {
		return nil
	}
	out := make([]string, 0, len(seen))
	for s := range seen {
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

// hostOf returns the host of a URL, or "" when the value is not one. The host
// alone is the identity: an allowlist authored as a set of hostnames must not
// be defeated by a different path or query on the same server.
func hostOf(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Host
}
