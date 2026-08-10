package oapiserver_test

// Conformance test for api/openapi/v2.yaml against the real chi router
// (UI reimplementation spec §5.1 / §9.3 unit W1).
//
// The generated server in internal/api/oapiserver is never mounted (preflight
// fact P3), so this test is the only thing that fails when the spec and the
// hand-assembled router in internal/api/router.go disagree.
//
// Forward direction (asserted here): every operationId in v2.yaml must
// resolve to a registered route.
//
// Reverse direction (hook only, by design): the spec covers ~23% of the
// router surface on purpose, so there is no global router→spec assertion.
// The manifest-driven reverse check activates automatically once unit P1
// lands apps/elitea-web/parity/manifest.json — see the manifest_reverse_check
// subtest below and oapiserver.MissingFromSpec.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/oapiserver"
	v2analytics "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/analytics"
	v2auth "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/auth"
	v2convs "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/conversations"
	v2events "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/events"
	v2folders "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/folders"
	v2skills "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
	v2tags "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/tags"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/webhook"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
)

const (
	// specPath is api/openapi/v2.yaml relative to this package directory.
	specPath = "../../../api/openapi/v2.yaml"
	// manifestPath is where unit P1 will land the new UI's parity manifest,
	// relative to this package directory (repo root is five levels up).
	manifestPath = "../../../../../apps/elitea-web/parity/manifest.json"

	// Sanity floors: the spec has 78 operationIds (84 before the W1 drift
	// removals and waivers W-008/W-009; +1 for W3's getBrandingBootstrap).
	// chi.Walk over the full-surface test config yields 313 method+pattern
	// registrations, 277 after the compat-shim exclusion in CollectRoutes
	// (4 shim patterns x 9 methods). It was 325/289 until #126 deleted the
	// twelve routes gated on the retired prototype indexer transport.
	// If either input collapses, the conformance loop would vacuously pass —
	// so guard the inputs themselves.
	minSpecOperations = 75
	minRouterRoutes   = 270
)

// buildFullSurfaceConfig returns a RouterConfig for the real production
// router (api.NewRouter) with every optional dependency satisfied by an inert
// stub, so that ALL conditionally-registered route groups are present. Stubs
// are zero-value structs embedding the dependency interface: they satisfy the
// interface at compile time and are never invoked, because this test only
// walks the route table and never serves a request.
//
// Deliberately left nil (their surface is not part of the public HTTP API the
// spec describes): AdminUI (static SPA mount), Shadow/Cutover (/internal/*),
// Pool/Storage/RedisClient (constructor-injected, nil-safe at registration).
func buildFullSurfaceConfig() api.RouterConfig {
	return api.RouterConfig{
		Auth: api.AuthDeps{
			SessionHandler: &v2auth.SessionHandler{},
			OIDCHandler:    &v2auth.OIDCHandler{},
		},
		AppsRepo:      struct{ applications.Repository }{},
		SkillsRepo:    struct{ v2skills.Repository }{},
		FoldersRepo:   struct{ v2folders.Repository }{},
		TagsRepo:      struct{ v2tags.Repository }{},
		AnalyticsRepo: struct{ v2analytics.Repository }{},
		ConvsRepo:     struct{ v2convs.Repository }{},
		WebhookRepo:   struct{ webhook.Repository }{},
		EventSource:   struct{ v2events.EventSource }{},
		LLMProxy:      http.NotFoundHandler(),
	}
}

func TestSpecRouterConformance(t *testing.T) {
	router := api.NewRouter(buildFullSurfaceConfig())

	routes, err := oapiserver.CollectRoutes(router)
	if err != nil {
		t.Fatalf("collecting routes: %v", err)
	}
	if routes.Len() < minRouterRoutes {
		t.Fatalf("router walk found only %d method+pattern registrations (want >= %d) — did a route group lose its stub dependency in buildFullSurfaceConfig?", routes.Len(), minRouterRoutes)
	}

	ops, err := oapiserver.LoadSpecOperations(specPath)
	if err != nil {
		t.Fatalf("loading spec: %v", err)
	}
	if len(ops) < minSpecOperations {
		t.Fatalf("spec declares only %d operations (want >= %d) — v2.yaml truncated?", len(ops), minSpecOperations)
	}

	t.Run("every_spec_operation_resolves_to_a_route", func(t *testing.T) {
		var unmatched []string
		for _, op := range ops {
			matched := false
			for _, cand := range op.CandidatePaths() {
				if routes.Resolves(op.Method, cand) {
					matched = true
					break
				}
			}
			if !matched {
				unmatched = append(unmatched, fmt.Sprintf(
					"  %-28s %-6s %s\n    tried: %s",
					op.OperationID, op.Method, op.Path,
					strings.Join(op.CandidatePaths(), " , ")))
			}
		}
		if len(unmatched) > 0 {
			t.Errorf("%d of %d spec operations in api/openapi/v2.yaml do not resolve to any registered chi route:\n%s\n\nEither register the route in internal/api/router.go or remove/fix the spec entry (spec §5.1).",
				len(unmatched), len(ops), strings.Join(unmatched, "\n"))
		}
	})

	// The reverse check is manifest-driven by design (spec covers ~23% of the
	// router). This subtest self-activates when unit P1 lands the manifest.
	t.Run("manifest_reverse_check", func(t *testing.T) {
		data, err := os.ReadFile(manifestPath)
		if os.IsNotExist(err) {
			t.Skipf("apps/elitea-web/parity/manifest.json not present yet (unit P1); reverse check activates when it lands")
		}
		if err != nil {
			t.Fatalf("reading manifest: %v", err)
		}
		var manifest struct {
			Endpoints []oapiserver.ManifestEndpoint `json:"endpoints"`
		}
		if err := json.Unmarshal(data, &manifest); err != nil {
			t.Fatalf("parsing manifest: %v", err)
		}
		for _, ep := range oapiserver.MissingFromSpec(ops, manifest.Endpoints) {
			t.Errorf("manifest endpoint %s (%s %s, operationId=%q) is not covered by api/openapi/v2.yaml", ep.ID, ep.Method, ep.Path, ep.OperationID)
		}
	})

	// Keep the reverse-check hook itself honest until the real manifest
	// exists: a manifest built from the spec's own operations must be fully
	// covered, and a bogus entry must be reported.
	t.Run("reverse_check_hook_selftest", func(t *testing.T) {
		selfManifest := make([]oapiserver.ManifestEndpoint, 0, len(ops))
		for _, op := range ops {
			selfManifest = append(selfManifest, oapiserver.ManifestEndpoint{
				ID:          "self." + op.OperationID,
				Method:      op.Method,
				Path:        op.CandidatePaths()[0],
				OperationID: op.OperationID,
			})
		}
		if missing := oapiserver.MissingFromSpec(ops, selfManifest); len(missing) != 0 {
			t.Errorf("self-manifest built from the spec reported %d missing endpoints: %+v", len(missing), missing)
		}

		bogus := []oapiserver.ManifestEndpoint{
			{ID: "bogus.byId", Method: "GET", Path: "/api/v2/nope", OperationID: "doesNotExistAnywhere"},
			{ID: "bogus.byPath", Method: "GET", Path: "/api/v2/definitely/not/in/the/spec"},
		}
		if missing := oapiserver.MissingFromSpec(ops, bogus); len(missing) != 2 {
			t.Errorf("reverse-check hook failed to flag bogus manifest entries: got %d missing, want 2", len(missing))
		}
	})
}
