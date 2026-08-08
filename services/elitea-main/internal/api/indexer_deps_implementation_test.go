package api_test

import (
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/indexersvc"
)

// indexerDepsAreSatisfiedByTheRPCClient is a compile-time assertion, not a
// runtime one: it exists so that "no implementation of the indexer ports
// exists" can never again be asserted from a grep.
//
// #123 filed exactly that claim about conversations and was wrong — Go
// interfaces are satisfied structurally, so an implementation never names the
// interface it implements and grepping for the interface name answers a
// different question than the one being asked. router_nil_gate_test.go's
// declaredAbsent entries for Predictor / ChatService / PipelineRunner /
// MCPSyncer previously repeated that mistake.
//
// *indexersvc.Client satisfies ALL SIX IndexerDeps fields. If this stops
// compiling, the reasons recorded in declaredAbsent have gone stale and must be
// re-derived rather than reworded.
//
// (For contrast: internal/compat/rpcbridge/indexer.Adapter satisfies only four
// of the six — its Status returns domain predict.PipelineStatus where
// v2pipelines.Runner wants v2pipelines.PipelineStatus, and its TestTool uses the
// domain toolkits request/response types rather than the v2toolkits ones. It
// also has zero importers.)
//
// Satisfying the interfaces is NOT the same as working: see declaredAbsent for
// why this client cannot currently reach pylon-indexer.
var indexerDepsAreSatisfiedByTheRPCClient = func(c *indexersvc.Client) api.IndexerDeps {
	return api.IndexerDeps{
		Predictor:      c,
		LLMService:     c,
		ChatService:    c,
		PipelineRunner: c,
		ToolTester:     c,
		MCPSyncer:      c,
	}
}

func TestIndexerDepsAreSatisfiedByTheRPCClient(t *testing.T) {
	t.Parallel()

	// A nil *indexersvc.Client is enough: the assertion under test is the
	// assignability above, which the compiler has already checked. Nothing here
	// dials Redis.
	deps := indexerDepsAreSatisfiedByTheRPCClient(nil)

	if deps.Predictor == nil || deps.LLMService == nil || deps.ChatService == nil ||
		deps.PipelineRunner == nil || deps.ToolTester == nil || deps.MCPSyncer == nil {
		t.Fatal("a typed non-nil interface holding a nil *indexersvc.Client compared equal to nil; " +
			"the fields are no longer interfaces and this assertion no longer proves anything")
	}
}
