package main

import (
	"context"
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/governance"
)

// TestMainWiring is the "wiring gate": it parses main.go and asserts that each
// must-call lifecycle method is actually invoked somewhere in this package's
// source. Rounds 1-3 of review each re-found a "built but not wired" bug — a
// lifecycle method that existed and unit-tested green but was never called from
// the composition root (GovernanceStore never constructed → image endpoints
// never gated → Drain never called on shutdown). A unit test of the method in
// isolation cannot catch that; this can. If someone deletes one of these calls,
// this test fails with a message naming the missing wiring.
//
// It is a source-level assertion (not a runtime callgraph) so it needs no live
// NATS/DB and runs in the existing `test` CI job in milliseconds.
func TestMainWiring(t *testing.T) {
	// Each entry: the call as it appears in source, and why it must be wired.
	required := []struct {
		call string
		why  string
	}{
		{"llmproxy.WithBudgetGate(", "the budget gate is never attached to the handler — every /llm request would be admitted unconditionally (enforcement silently off)"},
		{"account.New(", "the vault-backed Account is never constructed — the gateway runs the zero-provider bootstrap account and cannot resolve ANY provider credential (BFF.6)"},
		{"account.NewFernetVault(", "the Fernet vault is never constructed — {{secret.NAME}} credential references cannot be resolved (BFF.6)"},
		{"llmproxy.WithLoopBreaker(", "circular-routing guard #2 (spec §2.6) is never armed — a routing loop would run unchecked in production"},
		{"llmproxy.WithAlertEventPublisher(", "budget.soft_alert is never published to gateway.events.* — the 80% alert would be invisible to subscribers (spec §8.3)"},
		{"llmproxy.WithStreamGrace(", "the stream-disconnect grace period is never configured — a client that disconnects mid-stream is billed nothing and the hard budget is bypassable (issue #9)"},
		{"llmproxy.WithStreamDrainLimit(", "abandoned-stream drains are unbounded — a disconnect storm holds unbounded goroutines and provider sockets (issue #9)"},
		{"shutdownSequence(", "the shutdown sequence is never invoked — stream grace, HTTP drain, billing drain and NATS close would not run in the one order that loses no spend (issue #9)"},
		{"llmproxy.WithOpsEventPublisher(", "budget.unbilled_stream is never published — a stream the gateway could not bill would be invisible to operators (issue #9)"},
		{"govStore.Start(", "the recovery reconciler is inert until Start binds its context — CheckBudget would silently skip recovery"},
		{"makeHealthzHandler(", "the NATS circuit-breaker /healthz handler is never mounted — a pod with a dead budget-enforcement path stays in the load-balancer rotation"},
		{"drainForShutdown(", "in-flight billing + persist goroutines must be drained before pool.Close() or spend is dropped / a pool races"},
		{"grace.StopStreamGrace(", "phase 1 of shutdown is missing — the stream grace would extend the pod's termination window (issue #9)"},
		{"srv.ShutdownHTTP(", "graceful drain of in-flight SSE streams (§9.5) — without it, deploys truncate live responses"},
		{"srv.Close(", "the NATS client is never closed — and it MUST close after the billing drain, not inside the HTTP shutdown, or in-flight increments hit a dead connection"},
	}

	// Parse each non-test .go file in this package dir individually. (Avoids
	// parser.ParseDir, deprecated since Go 1.25 — SA1019.)
	fset := token.NewFileSet()
	goFiles, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob package dir: %v", err)
	}

	// Collect every selector-call (x.Method(...)) and every bare call (f(...))
	// across the non-test files of package main.
	calls := map[string]bool{}
	for _, name := range goFiles {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, perr := parser.ParseFile(fset, name, nil, 0)
		if perr != nil {
			t.Fatalf("parse %s: %v", name, perr)
		}
		ast.Inspect(f, func(n ast.Node) bool {
			ce, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			switch fn := ce.Fun.(type) {
			case *ast.SelectorExpr: // x.Method
				if id, ok := fn.X.(*ast.Ident); ok {
					calls[id.Name+"."+fn.Sel.Name+"("] = true
				}
			case *ast.Ident: // bareFunc
				calls[fn.Name+"("] = true
			}
			return true
		})
	}

	for _, r := range required {
		if !calls[r.call] {
			t.Errorf("WIRING GATE: %s is never called from package main — %s.\n"+
				"A lifecycle method that isn't called from the composition root is a "+
				"'built but not wired' bug (this class recurred 3x in review). Wire it in main().",
				r.call, r.why)
		}
	}
}

// These tests guard the SHUTDOWN WIRING, not the drain logic in isolation. A
// unit test proving Handler.DrainBilling()/GovernanceStore.Drain() work does NOT
// catch a future edit that stops main() from calling them — that
// "built-but-not-wired" gap recurred three times in review. drainForShutdown is
// the extracted, testable seam that main() calls.

type spyBillingDrainer struct {
	order *[]string
}

func (s *spyBillingDrainer) DrainBilling() { *s.order = append(*s.order, "billing") }

type spyGovDrainer struct {
	order *[]string
}

func (s *spyGovDrainer) Drain() { *s.order = append(*s.order, "gov") }

// TestDrainForShutdown_DrainsBothInOrder is the regression guard: if a refactor
// drops either drain call or reverses the order, this fails.
func TestDrainForShutdown_DrainsBothInOrder(t *testing.T) {
	var order []string
	drainForShutdown(&spyBillingDrainer{&order}, &spyGovDrainer{&order})

	if len(order) != 2 {
		t.Fatalf("expected both drains to run, got %v", order)
	}
	if order[0] != "billing" || order[1] != "gov" {
		t.Fatalf("drain order = %v, want [billing gov] — billing MUST drain before gov "+
			"so in-flight UpdateUsage calls finish before the store's persist WaitGroup closes", order)
	}
}

// TestDrainForShutdown_NilGovStore covers the enforcement-disabled path, where
// buildGovernance returns a typed-nil *GovernanceStore. drainForShutdown must
// still drain billing and must NOT panic dereferencing the nil store.
func TestDrainForShutdown_NilGovStore(t *testing.T) {
	var order []string
	var nilStore *governance.GovernanceStore // typed nil, as the disabled path passes
	drainForShutdown(&spyBillingDrainer{&order}, nilStore)

	if len(order) != 1 || order[0] != "billing" {
		t.Fatalf("with a nil gov store, only billing should drain; got %v", order)
	}
}

// --- /healthz response contract tests ----------------------------------------

type fakePinger struct {
	err error
}

func (f *fakePinger) Ping(_ context.Context) error { return f.err }

func TestHealthz_PingFailureReturns503(t *testing.T) {
	h := makeHealthzHandler(&fakePinger{err: errors.New("breaker open")})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not valid JSON: %s", rec.Body.String())
	}
	if body["error"] != "nats unavailable" {
		t.Errorf("error = %q, want %q", body["error"], "nats unavailable")
	}
}

func TestHealthz_PingOKReturns200(t *testing.T) {
	h := makeHealthzHandler(&fakePinger{err: nil})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != "ok" {
		t.Errorf("body = %q, want %q", body, "ok")
	}
}

func TestHealthz_NilPingerReturns200(t *testing.T) {
	h := makeHealthzHandler(nil)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}
