package api

import (
	"context"
	"testing"

	browserapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/browserauth"
	forwardapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/forwardauth"
)

type unusedPublicRuleCredentials struct{}

func (unusedPublicRuleCredentials) AuthenticateCredential(
	context.Context,
	forwardapp.Source,
	forwardapp.CredentialInput,
) (forwardapp.CredentialResult, error) {
	panic("public-rule test unexpectedly authenticated a credential")
}

type unusedPublicRuleSessions struct{}

func (unusedPublicRuleSessions) Authorize(context.Context, string) (browserapp.Authorization, error) {
	panic("public-rule test unexpectedly authorized a browser session")
}

func TestCurrentMainRoutePublicRulesMatchPinnedCatalog(t *testing.T) {
	rules := CurrentMainRoutePublicRules()
	want := []struct {
		name    string
		pattern string
		match   string
		near    string
	}{
		{"current.artifacts.s3", `/artifacts/s3/.*`, "/artifacts/s3/bucket/key", "/x/artifacts/s3/key"},
		{"current.admin_ui.assets", `/admin/app/.*\.(js|css|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|map)$`, "/admin/app/assets/main.js", "/admin/app/config.json"},
		{"current.elitea_core.socket_io", `/socket\.io/.*`, "/socket.io/connect", "/socketXio/connect"},
		{"current.elitea_core.robots", `/robots\.txt`, "/robots.txt", "/robots.txt/extra"},
		{"current.elitea_core.favicon", `/favicon\.ico`, "/favicon.ico", "/faviconXico"},
		{"current.elitea_core.access_denied", `/app/access_denied`, "/app/access_denied", "/app/access_denied/extra"},
		{"current.elitea_core.webhook", `/api/v2/elitea_core/webhook/prompt_lib/[0-9]+/[0-9]+/(github|gitlab|custom)`, "/api/v2/elitea_core/webhook/prompt_lib/7/9/github", "/api/v2/elitea_core/webhook/prompt_lib/7/x/github"},
		{"current.elitea_core.public_messages", `/elitea_core/[0-9]+/messages\?session_id=.+`, "/elitea_core/7/messages?session_id=abc", "/elitea_core/7/messages"},
		{"current.runtime_interface_litellm", `/llm/.*`, "/llm/v1/chat/completions", "/api/llm/v1/chat/completions"},
	}
	if len(rules) != len(want) {
		t.Fatalf("route-owned public rule count = %d, want %d", len(rules), len(want))
	}

	policy, err := forwardapp.NewPublicPolicy(rules)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := forwardapp.NewKernel(unusedPublicRuleCredentials{}, unusedPublicRuleSessions{}, policy)
	if err != nil {
		t.Fatal(err)
	}
	for index, expected := range want {
		rule := rules[index]
		if rule.Name != expected.name || len(rule.Conditions) != 1 ||
			rule.Conditions[0].Field != forwardapp.SourceURI ||
			rule.Conditions[0].Pattern != expected.pattern || rule.MatchAll {
			t.Fatalf("rule %d = %+v, want name=%q pattern=%q", index, rule, expected.name, expected.pattern)
		}
		if decision := authorizePublicURI(t, kernel, expected.match); decision.Kind != forwardapp.DecisionAllow ||
			decision.Authentication.Type != forwardapp.AuthenticationPublic ||
			decision.PublicMatch.RuleName != expected.name {
			t.Fatalf("positive %q decision = %+v", expected.match, decision)
		}
		if decision := authorizePublicURI(t, kernel, expected.near); decision.Kind != forwardapp.DecisionLogin {
			t.Fatalf("near-match %q decision = %+v, want login", expected.near, decision)
		}
	}
}

func TestCurrentMainRoutePublicRulesReturnsDetachedCatalog(t *testing.T) {
	rules := CurrentMainRoutePublicRules()
	rules[0].Name = "mutated"
	rules[0].Conditions[0].Pattern = ".*"
	again := CurrentMainRoutePublicRules()
	if again[0].Name != "current.artifacts.s3" || again[0].Conditions[0].Pattern != `/artifacts/s3/.*` {
		t.Fatalf("catalog aliased caller mutation: %+v", again[0])
	}
}

func authorizePublicURI(t *testing.T, kernel *forwardapp.Kernel, uri string) forwardapp.Decision {
	t.Helper()
	decision, err := kernel.Authorize(context.Background(), forwardapp.Request{
		Source: forwardapp.Source{
			Method: "GET",
			Proto:  "https",
			Host:   "elitea.example",
			URI:    uri,
			IP:     "203.0.113.10",
		},
		Traversal: forwardapp.MainTraversal,
	})
	if err != nil {
		t.Fatal(err)
	}
	return decision
}
