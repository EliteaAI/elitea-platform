package api_test

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// TestNilGatedRouterFieldsAreWiredOrDeclared is a source-level gate, not a
// behavioural test.
//
// router.go registers whole route groups behind `if cfg.X != nil`. When X is
// never populated, those routes are never registered and the API answers 404 —
// a 404 that is indistinguishable from a typo'd path, from a client bug, or from
// a route that was never specified. Nothing fails, nothing logs, and the gap can
// survive an entire replatform.
//
// It already has, three times independently:
//
//	AppsRepo   — a complete 425-line repository existed and nothing called its
//	             constructor. Agent creation 404'd in every deployment (#115).
//	ConvsRepo  — a 951-line repository existed with zero callers; 23
//	             conversation/message routes absent (#123). Filed initially as
//	             "no implementation at all", which was wrong: the check grepped
//	             for the interface NAME, and Go interfaces are satisfied
//	             structurally, so an implementation never mentions them.
//	admin UI   — a different shape of the same class: the E2E image substitutes a
//	             placeholder for the real admin SPA, so those journeys could never
//	             have tested it (#122).
//
// Each was found by accident, late, by someone chasing an unrelated symptom.
// This test makes the fourth one fail immediately and by name.
//
// It deliberately reads the SOURCE rather than constructing a router: the defect
// is "this field is never assigned anywhere in the composition root", which is a
// property of the wiring, not of any runtime behaviour a unit test could observe.
func TestNilGatedRouterFieldsAreWiredOrDeclared(t *testing.T) {
	t.Parallel()

	// Fields that are nil-gated on purpose and are NOT expected to be wired in
	// the default composition root. Each needs a reason, and a reason that names
	// a tracking issue where the absence is a gap rather than a design choice.
	//
	// This is not a dumping ground: an entry here asserts "the routes behind this
	// field are knowingly absent". Adding one to silence the test, without
	// meaning it, reintroduces exactly the invisibility this guards against.
	declaredAbsent := map[string]string{
		// Predictor / ChatService / PipelineRunner / MCPSyncer are the flat
		// projections of RouterConfig.Indexer (router.go defaults them from it).
		// The earlier reason here — "not implemented in the Go stack" — was
		// wrong in the same way #123 was wrong: an implementation DOES exist.
		// *indexersvc.Client structurally satisfies all six IndexerDeps fields
		// (verified with compile-time assertions, not a grep for the interface
		// name).
		//
		// It is still deliberately not wired, for a reason that is about the
		// WIRE PROTOCOL rather than about missing code:
		//
		//   indexersvc.Client publishes raw JSON to the Redis channel
		//   "elitea_rpc" and waits for a JSON reply on
		//   "elitea_main:rpc:reply:<id>".
		//
		//   The service actually listening on that channel is pylon-indexer,
		//   whose pylon.yml sets rpc.redis.queue = ${NAME_PREFIX}_rpc =
		//   "elitea_rpc". Pylon serves it through arbiter's RedisEventNode,
		//   whose codec is gzip(pickle(...)) [+ HMAC-SHA512]
		//   (legacy/plugins/arbiter/arbiter/eventnode/base.py decodes with
		//   pickle.loads(gzip.decompress(data))). JSON bytes fail
		//   gzip.decompress and are dropped, and arbiter replies through its own
		//   id_prefix correlation, never to a caller-supplied reply_channel.
		//   Nothing anywhere publishes to "elitea_main:rpc:reply:*".
		//
		// So wiring these would replace an immediate 404 with a 30s RPC timeout
		// (120s on the streaming routes) followed by a 500 — strictly worse for
		// the caller and for the server's connection budget. sibling proof:
		// elitea-scheduler's internal/rpc/client.go talks to the same channel
		// and DOES implement gzip+pickle+HMAC.
		//
		// The target architecture removes the question rather than fixing the
		// codec: elitea-docs spec-transport-implementation.mdx lists
		// internal/infra/indexersvc/rpc.go under "Modify or retire" — "Delete
		// after bounded dispatch/control/output adapters land". Wiring these
		// fields is blocked on that transport, not on writing a predictor.
		"ChatService":    "#126 — indexersvc.Client exists and satisfies it, but speaks JSON to an arbiter pickle channel; see note above",
		"Predictor":      "#126 — indexersvc.Client exists and satisfies it, but speaks JSON to an arbiter pickle channel; see note above",
		"PipelineRunner": "#126 — indexersvc.Client exists and satisfies it, but speaks JSON to an arbiter pickle channel; see note above",
		// Same correction as above: an implementation does exist
		// (indexersvc.Client.MCPSyncTools); it is unreachable for the protocol
		// reason described above, not unwritten.
		//
		// It also gates ZERO routes, contrary to the "30 routes absent" figure
		// that circulated in #126 and was repeated here. Its whole gated block
		// is one setter — `coreHandler.SetMCPSyncer(cfg.MCPSyncer)` at
		// router.go:508-510. The 30 came from an awk sweep that walked forward
		// from the `if` without tracking brace depth and kept counting routes
		// belonging to later blocks. Nothing 404s because of this field; the
		// failure mode is a handler running without a syncer, which is a
		// different bug and should not be counted as missing endpoints.
		"MCPSyncer": "#126 — indexersvc.Client satisfies it, but speaks JSON to an arbiter pickle channel; gates 0 routes (one setter), used by coreHandler",
		// Wired in main.go as of #126 follow-up: ConvsRepo, SkillsRepo, FoldersRepo,
		// TagsRepo, AnalyticsRepo and WebhookRepo were all pre-existing
		// repositories with zero callers. Their entries are gone from this map,
		// and the stale-entry check below fails if anyone re-adds them.
		//
		// WebhookRepo's entry used to read "webhooks not implemented in the Go
		// stack" — false, and false in the same way the ConvsRepo and Indexer
		// claims were. `dbrepos.NewWebhooksRepo(pool)` existed the whole time and
		// satisfies `webhook.Repository`; that was confirmed with a compile-time
		// assertion, and the assertion was mutation-checked by pointing it at
		// TagsRepo, which fails with "missing method Create".
		//
		// It hid one level deeper than the other five: its gate MOUNTS a
		// subrouter rather than declaring routes inline, so counting r.Get/r.Post
		// within the gated block yields zero and the field looks inert. The five
		// routes live in the handler's Routes(). Any future audit of this pattern
		// has to follow Mount targets, or it will undercount exactly here.
		"LLMProxy": "optional by design: the LLM proxy is a separate deployment (services/elitea-llm-gateway)",
		// EventSource is the NATS arm of the project-SSE fallback pair. It is
		// genuinely optional — but ONLY because RedisClient, the other arm, is
		// now wired (see the fallback-pair check below, which is what makes
		// this entry safe). No elitea-main deployment is given a NATS endpoint:
		// deploy/helm/nats is the LLM gateway's broker and elitea-main's only
		// NATS-shaped variable is GATEWAY_NATS_URL, the gateway *client*.
		//
		// The previous pair of entries here read "falls back to RedisClient"
		// and "the EventSource fallback" — each justified by the other, so both
		// being nil satisfied the allowlist while the route they gate was
		// entirely absent (#152). That is the hole the check below closes.
		"EventSource":    "#152 — the NATS arm; no elitea-main deployment runs NATS, and the Redis arm of this pair IS wired",
		"Shadow":         "cutover machinery, enabled per-deployment",
		"ShadowMetrics":  "cutover machinery, enabled per-deployment",
		"CutoverRouter":  "cutover machinery, enabled per-deployment",
		"CutoverTracker": "cutover machinery, enabled per-deployment",
	}

	root := repoRootFrom(t)
	routerSrc := readFile(t, filepath.Join(root, "internal/api/router.go"))
	mainSrc := readFile(t, filepath.Join(root, "cmd/elitea-main/main.go"))

	gated := regexp.MustCompile(`cfg\.([A-Za-z][A-Za-z0-9]*) != nil`)
	seen := map[string]bool{}
	for _, m := range gated.FindAllStringSubmatch(routerSrc, -1) {
		seen[m[1]] = true
	}
	if len(seen) == 0 {
		t.Fatal("found no `cfg.X != nil` gates in router.go — this test's premise no longer holds; " +
			"either the pattern changed or the regex is wrong. Do not delete this test without replacing the guarantee.")
	}

	assigned := func(field string) bool {
		// Assigned in the RouterConfig literal, e.g. "\tAppsRepo:  appsRepo,"
		return regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(field) + `:\s`).MatchString(mainSrc)
	}

	// --- Fallback pairs -------------------------------------------------
	//
	// The per-field allowlist above cannot see a two-arm gate:
	//
	//	if cfg.EventSource != nil      { r.Mount("/events/…", …) }
	//	else if cfg.RedisClient != nil { r.Mount("/events/…", …) }
	//
	// Each arm is individually "optional" — either one alone registers the
	// route — so each got an allowlist entry justified by the other, and the
	// pair passed the gate with BOTH nil and the route registered by neither.
	// That is #152, and it is a strictly worse failure than a single unwired
	// field: the reason text actively asserts the feature is fine.
	//
	// So: a fallback chain is only satisfiable by at least one member being
	// wired. The pairs are read out of router.go rather than listed here, so a
	// chain added later is covered without anyone remembering this test.
	// Matched by locating each `} else if cfg.B != nil {` and walking BACK to the
	// nearest preceding `if cfg.A != nil {`, rather than with one `(?s)if …
	// .*? … else if …` regex. The single-regex form silently mis-pairs: `.*?`
	// is leftmost-first, so an unrelated earlier `if cfg.X != nil {` claims the
	// match and the real chain is consumed inside it. That version passed this
	// very mutation (both arms nil, both allowlisted) — the bug it exists to
	// catch — while reporting a pair that was never there.
	ifGateRe := regexp.MustCompile(`if cfg\.([A-Za-z][A-Za-z0-9]*) != nil \{`)
	elseIfGateRe := regexp.MustCompile(`\}\s*else if cfg\.([A-Za-z][A-Za-z0-9]*) != nil \{`)

	var pairs [][2]string
	for _, loc := range elseIfGateRe.FindAllStringSubmatchIndex(routerSrc, -1) {
		second := routerSrc[loc[2]:loc[3]]
		prior := ifGateRe.FindAllStringSubmatch(routerSrc[:loc[0]], -1)
		if len(prior) == 0 {
			continue
		}
		pairs = append(pairs, [2]string{prior[len(prior)-1][1], second})
	}
	if len(pairs) == 0 {
		t.Fatal("found no `if cfg.A != nil { … } else if cfg.B != nil { … }` fallback chains in router.go — " +
			"either the last one was removed (delete this block) or the pattern changed. " +
			"Do not delete this without replacing the guarantee: a fallback pair with both arms nil " +
			"is how #152 shipped a route that existed in no deployment.")
	}
	for _, pair := range pairs {
		first, second := pair[0], pair[1]
		if assigned(first) || assigned(second) {
			continue
		}
		t.Errorf("RouterConfig.%s and RouterConfig.%s form a fallback pair in router.go "+
			"(`if cfg.%s != nil … else if cfg.%s != nil …`) and NEITHER is assigned in cmd/elitea-main/main.go.\n"+
			"  The routes behind that chain are registered by no arm and answer 404 in every deployment.\n"+
			"  An allowlist entry for one arm that points at the other is circular and does NOT satisfy this:\n"+
			"  at least one member has to be genuinely wired. (#152)",
			first, second, first, second)
	}

	var unwired, staleAllowlist []string
	for field := range seen {
		isAssigned := assigned(field)
		_, declared := declaredAbsent[field]

		switch {
		case isAssigned && declared:
			staleAllowlist = append(staleAllowlist, field)
		case !isAssigned && !declared:
			unwired = append(unwired, field)
		}
	}
	sort.Strings(unwired)
	sort.Strings(staleAllowlist)

	for _, f := range unwired {
		t.Errorf("RouterConfig.%s gates routes in router.go but is never assigned in cmd/elitea-main/main.go.\n"+
			"  Those routes are silently unregistered and answer 404 in every deployment.\n"+
			"  Either wire it, or add it to declaredAbsent in this test WITH an issue reference —\n"+
			"  so the gap is visible instead of being discovered by someone debugging a 404.", f)
	}
	for _, f := range staleAllowlist {
		t.Errorf("RouterConfig.%s is now wired in main.go but is still listed in declaredAbsent.\n"+
			"  Remove the entry: a stale allowlist hides the next real regression for this field.", f)
	}
}

func repoRootFrom(t *testing.T) string {
	t.Helper()
	// This test lives in internal/api/, so the service root is two levels up.
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatalf("resolve service root: %v", err)
	}
	return root
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path) //nolint:gosec // fixed, test-local path
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if strings.TrimSpace(string(b)) == "" {
		t.Fatalf("%s is empty", path)
	}
	return string(b)
}
