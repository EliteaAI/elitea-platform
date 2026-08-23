package policy

import (
	"strings"
	"testing"
	"time"
)

var testNow = time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)

// row is a terse constructor for a test row.
func row(id, typ, name string, data map[string]any) Row {
	return Row{ID: id, Type: typ, Section: "governance", Name: name, Data: data, Enabled: true}
}

func TestCompileParsesEachType(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeBudget, "global", map[string]any{
			"budget": map[string]any{"limit_usd": 250.0, "period": "monthly", "soft_alert_pct": 90.0},
		}),
		row("2", TypeRateLimit, "cap", map[string]any{
			"rate_limit": map[string]any{"requests_per_min": 60.0, "tokens_per_min": 100000.0},
		}),
		row("3", TypeCredentialPolicy, "internal", map[string]any{
			"credential": map[string]any{"rate_policy": RatePolicyExcluded},
		}),
		row("4", TypeModelConfig, "allow", map[string]any{
			"scope": map[string]any{"providers": []any{"openai"}, "models": []any{"gpt-4o"}},
		}),
		row("5", TypeMCPAllowlist, "mcp", map[string]any{
			"mcp": map[string]any{"allowlist": []any{"github"}},
		}),
		row("6", TypeRoutingRule, "cheap", map[string]any{
			"cel":      `provider == "openai"`,
			"priority": 10.0,
			"targets":  []any{map[string]any{"provider": "anthropic", "model": "claude", "weight": 1.0}},
		}),
	}, testNow)

	if len(snap.Rejected) != 0 {
		t.Fatalf("expected no rejections, got %+v", snap.Rejected)
	}
	d := snap.Diagnostics()
	for name, got := range map[string]int{
		"budgets": d.Budgets, "rate_limits": d.RateLimits, "model_configs": d.ModelConfigs,
		"mcp_allowlists": d.MCPAllowlists, "credential_policies": d.CredentialPolicy, "routing_rules": d.RoutingRules,
	} {
		if got != 1 {
			t.Errorf("%s = %d, want 1", name, got)
		}
	}
	if !d.LoadedAt.Equal(testNow) {
		t.Errorf("LoadedAt = %v, want %v", d.LoadedAt, testNow)
	}
}

// TestDisabledRowsAreNotEnforced is the most basic promise the admin toggle
// makes. The SELECT already filters on enabled, so this guards the second line
// of defence for a row that reaches Compile some other way.
func TestDisabledRowsAreNotEnforced(t *testing.T) {
	t.Parallel()

	r := row("1", TypeModelConfig, "allow", map[string]any{
		"scope": map[string]any{"models": []any{"gpt-4o"}},
	})
	r.Enabled = false
	snap := Compile([]Row{r}, testNow)

	if dec := snap.CheckModel(Subject{ProjectID: 7, Model: "anything"}); dec.Restricted {
		t.Error("a disabled model_config row still restricted the request")
	}
}

// TestMalformedRowIsRejectedByNameAndTheRestSurvives is the property that keeps
// one bad rule from disarming the whole corpus.
func TestMalformedRowIsRejectedByNameAndTheRestSurvives(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("bad", TypeRoutingRule, "broken", map[string]any{
			"cel":     `provider ==`,
			"targets": []any{map[string]any{"provider": "openai", "model": "gpt-4o", "weight": 1.0}},
		}),
		row("good", TypeRateLimit, "cap", map[string]any{
			"rate_limit": map[string]any{"requests_per_min": 10.0},
		}),
	}, testNow)

	if len(snap.Rejected) != 1 {
		t.Fatalf("want exactly 1 rejection, got %+v", snap.Rejected)
	}
	if snap.Rejected[0].ID != "bad" || !strings.Contains(snap.Rejected[0].Reason, "compile error") {
		t.Errorf("rejection does not name the row and the reason: %+v", snap.Rejected[0])
	}
	if _, ok := snap.RateLimit(Subject{ProjectID: 1}); !ok {
		t.Error("the healthy rate-limit row was lost alongside the malformed routing row")
	}
}

// TestUnknownTypeIsRejectedButBudgetAlertIsNot pins the one type this plane
// deliberately ignores. A false rejection sitting in the list for ever is how a
// real one gets missed.
func TestUnknownTypeIsRejectedButBudgetAlertIsNot(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("a", TypeBudgetAlert, "global", map[string]any{"enabled": true, "threshold_pct": 80.0}),
		row("b", "budgets", "typo", map[string]any{}),
	}, testNow)

	if len(snap.Rejected) != 1 || snap.Rejected[0].ID != "b" {
		t.Fatalf("want only the misspelled type rejected, got %+v", snap.Rejected)
	}
}

// TestTeamScopedRowIsInertNotSilent is the guard on the platform's missing team
// concept. The row must be reported, not quietly dropped and not treated as
// matching everything.
func TestTeamScopedRowIsInertNotSilent(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeModelConfig, "team-scoped", map[string]any{
			"scope": map[string]any{"team_ids": []any{4.0}, "models": []any{"gpt-4o"}},
		}),
	}, testNow)

	if len(snap.Inert) != 1 {
		t.Fatalf("want the team-scoped row reported as inert, got %+v", snap.Inert)
	}
	if !strings.Contains(snap.Inert[0].Reason, "no teams") {
		t.Errorf("inert reason does not explain why: %q", snap.Inert[0].Reason)
	}
	if dec := snap.CheckModel(Subject{ProjectID: 1, Model: "gpt-4o"}); dec.Restricted {
		t.Error("an inert row was still applied to a request")
	}
}

func TestBudgetValidation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		data       map[string]any
		wantReject string
	}{
		{"bad period", map[string]any{"budget": map[string]any{"period": "fortnightly", "limit_usd": 1.0}}, "budget.period"},
		{"negative limit", map[string]any{"budget": map[string]any{"limit_usd": -1.0}}, "must not be negative"},
		{"soft alert out of range", map[string]any{"budget": map[string]any{"limit_usd": 1.0, "soft_alert_pct": 101.0}}, "between 1 and 100"},
		{"bad fail mode", map[string]any{"budget": map[string]any{"limit_usd": 1.0, "nats_fail_mode": "fail_sideways"}}, "nats_fail_mode"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			snap := Compile([]Row{row("1", TypeBudget, "b", tc.data)}, testNow)
			if len(snap.Rejected) != 1 {
				t.Fatalf("want 1 rejection, got %+v", snap.Rejected)
			}
			if !strings.Contains(snap.Rejected[0].Reason, tc.wantReject) {
				t.Errorf("reason %q does not mention %q", snap.Rejected[0].Reason, tc.wantReject)
			}
		})
	}
}

// TestBudgetWithNoCeilingIsUnlimited pins the derivation gateway.project_budget
// makes in SQL. The two definitions of "unlimited" must not diverge.
func TestBudgetWithNoCeilingIsUnlimited(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeBudget, "no-ceiling", map[string]any{
			"budget": map[string]any{"is_unlimited": false},
		}),
	}, testNow)

	def, ok := snap.Budget(Subject{ProjectID: 1})
	if !ok {
		t.Fatal("the budget row did not load")
	}
	if !def.IsUnlimited {
		t.Error("a row with no limit_usd is not unlimited; it would enforce a zero ceiling")
	}
	if _, ok := snap.DefaultBudget(1); ok {
		t.Error("an unlimited row was offered as a fallback ceiling")
	}
}

func TestLimitNanoUSD(t *testing.T) {
	t.Parallel()

	usd := 12.34
	def := BudgetDef{LimitUSD: &usd}
	nano, ok := def.LimitNanoUSD()
	if !ok || nano != 12_340_000_000 {
		t.Errorf("LimitNanoUSD() = %d, %v; want 12340000000, true", nano, ok)
	}

	huge := 1e12 // 1 trillion USD overflows the nano-USD int64.
	if _, ok := (BudgetDef{LimitUSD: &huge}).LimitNanoUSD(); ok {
		t.Error("an overflowing ceiling was converted; it would wrap negative and admit everything")
	}
	if _, ok := (BudgetDef{IsUnlimited: true}).LimitNanoUSD(); ok {
		t.Error("an unlimited budget produced a ceiling")
	}
}

// TestNumericCoercion covers the shapes a JSONB round-trip and a form post can
// produce for the same authored number.
func TestNumericCoercion(t *testing.T) {
	t.Parallel()

	snap := Compile([]Row{
		row("1", TypeRateLimit, "strings", map[string]any{
			"rate_limit": map[string]any{"requests_per_min": "45", "tokens_per_min": "900"},
		}),
	}, testNow)

	def, ok := snap.RateLimit(Subject{ProjectID: 1})
	if !ok {
		t.Fatalf("row did not load: %+v", snap.Rejected)
	}
	if def.RequestsPerMin != 45 || def.TokensPerMin != 900 {
		t.Errorf("got %d req/min and %d tok/min, want 45 and 900", def.RequestsPerMin, def.TokensPerMin)
	}
}
