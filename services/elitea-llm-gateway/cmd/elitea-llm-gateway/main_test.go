package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
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
		{"handler.StopStreamGrace(", "phase 1 of shutdown is missing — the stream grace would extend the pod's termination window (issue #9)"},
		{"llmproxy.WithOpsEventPublisher(", "budget.unbilled_stream is never published — a stream the gateway could not bill would be invisible to operators (issue #9)"},
		{"govStore.Start(", "the recovery reconciler is inert until Start binds its context — CheckBudget would silently skip recovery"},
		{"drainForShutdown(", "in-flight billing + persist goroutines must be drained before pool.Close() or spend is dropped / a pool races"},
		{"srv.Shutdown(", "graceful drain of in-flight SSE streams (§9.5) — without it, deploys truncate live responses"},
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

// TestShutdownOrdering is the ordering half of the wiring gate: it is not
// enough that StopStreamGrace, srv.Shutdown and drainForShutdown are all
// called — they must run in that order.
//
// Getting this wrong is not cosmetic. With drainForShutdown before
// srv.Shutdown, billingClosing is set while SSE handlers are still live, so a
// detached drain that HAS recovered the provider's authoritative usage trailer
// gets its increment refused and the spend is dropped — silently, on every
// rolling deploy. That is exactly what the gateway-review probe reproduced
// (231000 nano-USD lost, 0 UpdateUsage calls, 0 loss events).
func TestShutdownOrdering(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	body := string(src)

	stop := strings.Index(body, "handler.StopStreamGrace()")
	shutdown := strings.Index(body, "srv.Shutdown(")
	drain := strings.Index(body, "drainForShutdown(handler")

	if stop < 0 || shutdown < 0 || drain < 0 {
		t.Fatalf("shutdown calls missing: StopStreamGrace=%d srv.Shutdown=%d drainForShutdown=%d",
			stop, shutdown, drain)
	}
	if stop >= shutdown || shutdown >= drain {
		t.Errorf("shutdown order is StopStreamGrace@%d, srv.Shutdown@%d, drainForShutdown@%d; "+
			"want StopStreamGrace < srv.Shutdown < drainForShutdown. Draining billing before the "+
			"HTTP drain refuses the increment for any stream still settling, dropping recovered spend.",
			stop, shutdown, drain)
	}
}
