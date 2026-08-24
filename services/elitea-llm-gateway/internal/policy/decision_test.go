package policy

import (
	"reflect"
	"strings"
	"testing"
)

// --- model allowlist ------------------------------------------------------

func TestCheckModelUnrestrictedWhenNoRowSelectsTheProject(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeModelConfig, "p9-only", map[string]any{
			"scope": map[string]any{"project_ids": []any{9.0}, "models": []any{"gpt-4o"}},
		}),
	}, testNow)

	dec := snap.CheckModel(Subject{ProjectID: 7, Provider: "openai", Model: "anything"})
	if dec.Restricted {
		t.Error("a row scoped to another project restricted this one")
	}
}

func TestCheckModelUnionsSelectingRows(t *testing.T) {
	t.Parallel()

	// Two rows, each granting one provider to project 7. An operator authoring
	// one row per provider expects both to be permitted; an INTERSECTION would
	// make the second row silently revoke the first.
	snap := Compile([]Row{
		row("1", TypeModelConfig, "openai", map[string]any{
			"scope": map[string]any{"project_ids": []any{7.0}, "providers": []any{"openai"}},
		}),
		row("2", TypeModelConfig, "anthropic", map[string]any{
			"scope": map[string]any{"project_ids": []any{7.0}, "providers": []any{"anthropic"}},
		}),
	}, testNow)

	for _, provider := range []string{"openai", "anthropic"} {
		dec := snap.CheckModel(Subject{ProjectID: 7, Provider: provider, Model: "m"})
		if !dec.Restricted || !dec.Allowed {
			t.Errorf("provider %q: restricted=%v allowed=%v, want true/true", provider, dec.Restricted, dec.Allowed)
		}
	}
	dec := snap.CheckModel(Subject{ProjectID: 7, Provider: "cohere", Model: "m"})
	if !dec.Restricted || dec.Allowed {
		t.Errorf("a provider in neither row was permitted: %+v", dec)
	}
	if len(dec.Rules) != 2 {
		t.Errorf("the refusal does not name both rows that produced it: %v", dec.Rules)
	}
}

func TestCheckModelIsCaseInsensitive(t *testing.T) {
	t.Parallel()

	// The admin form, the model catalogue row and bifrost's provider constants
	// disagree about case. A rule that fails to match because an operator typed
	// "OpenAI" is a silent hole, not a visible typo.
	snap := Compile([]Row{
		row("1", TypeModelConfig, "allow", map[string]any{
			"scope": map[string]any{"providers": []any{"OpenAI"}, "models": []any{"GPT-4o"}},
		}),
	}, testNow)

	dec := snap.CheckModel(Subject{ProjectID: 1, Provider: "openai", Model: "gpt-4o"})
	if !dec.Allowed {
		t.Error("a case difference defeated the allowlist")
	}
}

func TestCheckModelEmptyScopeExemptsTheProject(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeModelConfig, "global", map[string]any{
			"scope": map[string]any{"models": []any{"gpt-4o"}},
		}),
		row("2", TypeModelConfig, "exempt-p7", map[string]any{
			"scope": map[string]any{"project_ids": []any{7.0}},
		}),
	}, testNow)

	if dec := snap.CheckModel(Subject{ProjectID: 1, Model: "claude"}); dec.Allowed {
		t.Error("the global allowlist did not bite on a project it selects")
	}
	if dec := snap.CheckModel(Subject{ProjectID: 7, Model: "claude"}); !dec.Allowed {
		t.Error("the exemption row did not re-permit the project it names")
	}
}

// --- narrowest-wins -------------------------------------------------------

func TestNarrowestDefinitionWins(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeRateLimit, "global", map[string]any{
			"rate_limit": map[string]any{"requests_per_min": 1000.0},
		}),
		row("2", TypeRateLimit, "project-7", map[string]any{
			"scope":      map[string]any{"project_ids": []any{7.0}},
			"rate_limit": map[string]any{"requests_per_min": 10.0},
		}),
	}, testNow)

	def, ok := snap.RateLimit(Subject{ProjectID: 7})
	if !ok || def.RequestsPerMin != 10 {
		t.Errorf("project 7 got %d req/min, want the project-scoped 10", def.RequestsPerMin)
	}
	def, ok = snap.RateLimit(Subject{ProjectID: 8})
	if !ok || def.RequestsPerMin != 1000 {
		t.Errorf("project 8 got %d req/min, want the global 1000", def.RequestsPerMin)
	}
}

// TestProviderScopedRowDoesNotMatchAnUnknownProvider pins the direction of the
// "constraint the subject cannot answer" rule. Admission does not know the
// provider on every route, and a provider-scoped ceiling must not be applied on
// a guess.
func TestProviderScopedRowDoesNotMatchAnUnknownProvider(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeRateLimit, "openai-only", map[string]any{
			"scope":      map[string]any{"providers": []any{"openai"}},
			"rate_limit": map[string]any{"requests_per_min": 5.0},
		}),
	}, testNow)

	if _, ok := snap.RateLimit(Subject{ProjectID: 1, Provider: ""}); ok {
		t.Error("a provider-scoped rate limit matched a subject with no provider")
	}
	if _, ok := snap.RateLimit(Subject{ProjectID: 1, Provider: "openai"}); !ok {
		t.Error("the provider-scoped rate limit did not match its own provider")
	}
}

// --- credential rate policy ----------------------------------------------

func TestCredentialPolicyDefaultsToBilled(t *testing.T) {
	t.Parallel()

	empty := Compile(nil, testNow)
	if got := empty.CredentialPolicy(Subject{ProjectID: 1}); got != RatePolicyBilled {
		t.Errorf("CredentialPolicy with no rows = %q, want %q — an unreadable definition must never "+
			"be the reason spend goes unrecorded", got, RatePolicyBilled)
	}
	if got := Empty.CredentialPolicy(Subject{ProjectID: 1}); got != RatePolicyBilled {
		t.Errorf("the Empty snapshot answered %q", got)
	}

	snap := Compile([]Row{
		row("1", TypeCredentialPolicy, "free", map[string]any{
			"scope":      map[string]any{"project_ids": []any{7.0}},
			"credential": map[string]any{"rate_policy": RatePolicyZeroRateMetered},
		}),
	}, testNow)
	if got := snap.CredentialPolicy(Subject{ProjectID: 7}); got != RatePolicyZeroRateMetered {
		t.Errorf("got %q, want %q", got, RatePolicyZeroRateMetered)
	}
	if got := snap.CredentialPolicy(Subject{ProjectID: 8}); got != RatePolicyBilled {
		t.Errorf("an unselected project got %q, want %q", got, RatePolicyBilled)
	}
}

func TestInvalidRatePolicyIsRejected(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeCredentialPolicy, "typo", map[string]any{
			"credential": map[string]any{"rate_policy": "free"},
		}),
	}, testNow)
	if len(snap.Rejected) != 1 {
		t.Fatalf("want the invalid policy rejected, got %+v", snap.Rejected)
	}
	// The row must not silently become "billed"; it must not load at all.
	if got := snap.CredentialPolicy(Subject{ProjectID: 1}); got != RatePolicyBilled {
		t.Errorf("got %q", got)
	}
}

// --- MCP allowlist --------------------------------------------------------

func TestCheckMCP(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeMCPAllowlist, "approved", map[string]any{
			"scope": map[string]any{"project_ids": []any{7.0}},
			"mcp":   map[string]any{"allowlist": []any{"github", "mcp.internal.example"}},
		}),
	}, testNow)

	sub := Subject{ProjectID: 7}
	if dec := snap.CheckMCP(sub, []string{"github"}); dec.Restricted && len(dec.Denied) > 0 {
		t.Errorf("an allowlisted server was denied: %+v", dec)
	}
	dec := snap.CheckMCP(sub, []string{"github", "evil.example"})
	if !dec.Restricted || !reflect.DeepEqual(dec.Denied, []string{"evil.example"}) {
		t.Errorf("denied = %v, want [evil.example]", dec.Denied)
	}
	// A request naming no MCP server is never restricted.
	if dec := snap.CheckMCP(sub, nil); dec.Restricted {
		t.Error("a request with no MCP servers was restricted")
	}
	// A project the row does not select is unrestricted.
	if dec := snap.CheckMCP(Subject{ProjectID: 8}, []string{"evil.example"}); dec.Restricted {
		t.Error("a project outside the row's scope was restricted")
	}
}

// TestEmptyMCPAllowlistPermitsEverything pins the field's own description.
// Reading an empty list as "deny all" would lock every server out the moment an
// operator cleared the chips.
func TestEmptyMCPAllowlistPermitsEverything(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeMCPAllowlist, "cleared", map[string]any{
			"mcp": map[string]any{"allowlist": []any{}},
		}),
	}, testNow)

	if dec := snap.CheckMCP(Subject{ProjectID: 1}, []string{"anything"}); dec.Restricted {
		t.Error("an empty allowlist denied a server; the field defines empty as 'all permitted'")
	}
	if len(snap.Inert) != 1 || !strings.Contains(snap.Inert[0].Reason, "allowlist is OFF") {
		t.Errorf("the cleared allowlist was not reported as inert: %+v", snap.Inert)
	}
}

// --- nil-safety -----------------------------------------------------------

// TestNilSnapshotIsEnforcementNeutral covers the state a gateway holds before
// its first load and when it has no database. Every accessor must answer
// "no definition" rather than panicking or restricting.
func TestNilSnapshotIsEnforcementNeutral(t *testing.T) {
	t.Parallel()

	var snap *Snapshot
	sub := Subject{ProjectID: 1, Provider: "openai", Model: "gpt-4o"}

	if _, ok := snap.Budget(sub); ok {
		t.Error("nil snapshot returned a budget")
	}
	if _, ok := snap.RateLimit(sub); ok {
		t.Error("nil snapshot returned a rate limit")
	}
	if dec := snap.CheckModel(sub); dec.Restricted {
		t.Error("nil snapshot restricted a model")
	}
	if dec := snap.CheckMCP(sub, []string{"x"}); dec.Restricted {
		t.Error("nil snapshot restricted an MCP server")
	}
	if got := snap.CredentialPolicy(sub); got != RatePolicyBilled {
		t.Errorf("nil snapshot rate policy = %q", got)
	}
	if dec := snap.Route(sub, RoutingInputs{}, nil, nil); dec.Matched {
		t.Error("nil snapshot routed a request")
	}
	d := snap.Diagnostics()
	if d.Rejected == nil || d.Inert == nil {
		t.Error("nil snapshot Diagnostics returned nil slices; they must serialise as [] not null")
	}
}
