package policy

import (
	"reflect"
	"testing"
)

func TestMCPServersFromRequest(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
		want []string
	}{
		{
			name: "openai responses mcp tool",
			body: `{"model":"gpt-4o","tools":[{"type":"mcp","server_label":"github","server_url":"https://mcp.example.com/sse"}]}`,
			// Both spellings are returned: an operator may have allowlisted
			// either, and making them guess which one the gateway uses would
			// make the control unusable.
			want: []string{"github", "mcp.example.com"},
		},
		{
			name: "anthropic mcp_servers",
			body: `{"model":"claude","mcp_servers":[{"type":"url","name":"internal","url":"https://mcp.internal:8443/x"}]}`,
			want: []string{"internal", "mcp.internal:8443"},
		},
		{
			name: "a non-mcp tool is ignored",
			body: `{"tools":[{"type":"function","function":{"name":"get_weather"}}]}`,
			want: nil,
		},
		{
			name: "no tools at all",
			body: `{"model":"gpt-4o","messages":[]}`,
			want: nil,
		},
		{
			name: "malformed body yields nothing",
			body: `{not json`,
			want: nil,
		},
		{
			name: "empty body yields nothing",
			body: ``,
			want: nil,
		},
		{
			name: "duplicates collapse and the result is sorted",
			body: `{"tools":[{"type":"mcp","server_label":"b"},{"type":"mcp","server_label":"a"},{"type":"mcp","server_label":"b"}]}`,
			want: []string{"a", "b"},
		},
		{
			name: "type match is case-insensitive",
			body: `{"tools":[{"type":"MCP","server_label":"github"}]}`,
			want: []string{"github"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := MCPServersFromRequest([]byte(tc.body)); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("MCPServersFromRequest() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestHostOfIgnoresPathAndQuery is why the host alone is the identity: an
// allowlist of hostnames must not be defeated by a different path on the same
// server.
func TestHostOfIgnoresPathAndQuery(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{
		"https://mcp.example.com/sse",
		"https://mcp.example.com/other/path?token=x",
		"http://mcp.example.com",
	} {
		if got := hostOf(raw); got != "mcp.example.com" {
			t.Errorf("hostOf(%q) = %q", raw, got)
		}
	}
	if got := hostOf("not a url"); got != "" {
		t.Errorf("hostOf on a non-URL = %q, want empty", got)
	}
}
