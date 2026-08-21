// Package sdkharness serves the REAL gateway /llm router to a REAL elitea-sdk
// client, over a plain HTTP port, with no provider and no database.
//
// # WHY IT EXISTS
//
// Every other compatibility claim the gateway makes about elitea-sdk rests on
// READING the SDK source and reproducing its logic in Go. That is how the
// budget defect shipped: the gateway wrote a correct-looking 402 whose SCOPE
// sat in error.type, the SDK matches on error.type alone and reads the scope
// from error.code, budget_exceeded_from returned None, no typed exception was
// raised, and a policy refusal reached the model as message content. Every Go
// test passed, because every Go test restated the same wrong literal.
//
// This package removes the reproduction. scripts/sdk-conformance/conformance.py
// drives the installed SDK against the handler assembled here, so a failure is
// a failure the SDK itself would have.
//
// # WHAT IT IS NOT
//
// It is not a deployment. It never serves a provider, it holds no credential,
// it binds loopback by default and it exposes a control endpoint that changes
// the budget verdict. cmd/sdk-conformance-harness is the only caller.
//
// # THE EDGE SHIM
//
// In production elitea-main is the edge: it authenticates the caller, resolves
// the project, and forwards X-Elitea-Project-Id / X-Elitea-User-Id to the
// gateway. The SDK sends neither header — it sends OpenAI-Organization, which
// is what elitea-main's project selector reads. This package therefore plays
// the edge: it records the headers the SDK sent, then derives the gateway's
// identity headers from OpenAI-Organization.
//
// That derivation is load-bearing rather than a convenience. If the SDK stopped
// sending OpenAI-Organization the gateway would resolve no project, the budget
// gate would admit every request, and both 402 assertions in the Python driver
// would fail. The header assertion and the refusal assertions test the same
// wire fact from two directions.
package sdkharness

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sony/gobreaker/v2"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/api"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/cost"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/failmode"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/governance"
	natspkg "github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/infra/nats"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/llmproxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/preflight"
	"github.com/maximhq/bifrost/core/schemas"
)

// Verdict names the budget answer the harness gives to the next request.
type Verdict string

const (
	// VerdictAllow admits the request at both ceilings.
	VerdictAllow Verdict = "allow"
	// VerdictProject402 exhausts the PROJECT ceiling. The member ceiling is
	// never consulted, because the member cap sits inside the project one.
	VerdictProject402 Verdict = "project-402"
	// VerdictMember402 admits at the project ceiling and exhausts the MEMBER
	// one. This is the refusal whose scope the shipped defect lost.
	VerdictMember402 Verdict = "member-402"
)

// Verdicts is every accepted value, for error messages and for the Go test.
var Verdicts = []Verdict{VerdictAllow, VerdictProject402, VerdictMember402}

const (
	// seededSpendNano is the authoritative counter value the fake NATS tier
	// reports for EVERY subject. The verdict is expressed as a LIMIT rather
	// than as a spend so the harness never has to reconstruct the gateway's
	// billing-period subject arithmetic; getting that arithmetic wrong in a
	// second place would seed the wrong key, read back zero, and admit the
	// request — a false pass on exactly the assertion that matters.
	seededSpendNano int64 = 5_000_000_000 // $5
	// limitBelowSpend puts the ceiling under seededSpendNano, so
	// failmode.Decide's NATS_HEALTHY branch returns Block402.
	limitBelowSpend int64 = 1_000_000_000 // $1
	// limitAboveSpend puts the ceiling far above seededSpendNano, so the same
	// branch returns Allow and stays below the soft-alert threshold.
	limitAboveSpend int64 = 1_000_000_000_000 // $1000
	// harnessSoftAlertPct matches the platform default. Nothing in the driver
	// asserts on soft alerts; the value exists so the snapshot is well formed.
	harnessSoftAlertPct = 80
)

// embeddingDim is the width of the canned embedding vector. It is small on
// purpose: the assertion is on the exact width, and a small number makes a
// truncated or mis-decoded base64 payload obvious in the failure text.
const embeddingDim = 8

// Config configures the harness server.
type Config struct {
	// ProjectID is the project the driver must select with OpenAI-Organization.
	// A request that names any other project is still served, but its identity
	// header carries what the SDK sent, so a mismatch shows up in the journal.
	ProjectID int
	// UserID is the member the edge shim attributes every request to. The
	// gateway's member ceiling cannot be reached without it: memberVerdict
	// admits a request with no resolvable member id.
	UserID int
	// Logger receives the handler's own logs. nil discards them.
	Logger *slog.Logger
}

// Server is the assembled harness.
type Server struct {
	cfg     Config
	handler http.Handler

	// stop cancels the reconciler's sweep loop. Without it every New() leaks
	// one goroutine for the life of the process, because a background context
	// can never fire the loop's <-ctx.Done() case. Callers must Close.
	stop context.CancelFunc

	stateMu sync.RWMutex
	verdict Verdict

	journalMu sync.Mutex
	journal   []JournalEntry
}

// JournalEntry is one inbound request as the SDK sent it, plus the status the
// real router answered with.
//
// The headers are recorded BEFORE the edge shim adds the gateway identity
// headers. That ordering is the whole point: the driver asserts what the SDK
// put on the wire, not what this file put there afterwards.
type JournalEntry struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Status  int               `json:"status"`
	Verdict string            `json:"verdict"`
	Headers map[string]string `json:"headers"`
	// Body holds the few top-level scalar fields of a JSON request body that
	// the driver asserts on — encoding_format above all. openai-python injects
	// encoding_format=base64 when the caller omits it, and LangChain omits it;
	// without this record the driver could only infer that the base64 path ran,
	// and an inference is what tier 2 exists to replace.
	Body map[string]any `json:"body"`
}

// New assembles the harness: the real chi router over the real llmproxy
// handler, a real GovernanceStore over in-memory tiers, and the edge shim.
func New(cfg Config) (*Server, error) {
	if cfg.ProjectID <= 0 {
		return nil, errors.New("sdkharness: ProjectID must be positive; the budget gate " +
			"treats an unresolvable project as unlimited, so a zero here would admit every request")
	}
	if cfg.UserID <= 0 {
		return nil, errors.New("sdkharness: UserID must be positive; memberVerdict admits a " +
			"request with no resolvable member id, so a zero here would make the member-402 " +
			"verdict unreachable and its assertion vacuous")
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(discard{}, nil))
	}

	s := &Server{cfg: cfg, verdict: VerdictAllow}

	db := &verdictDB{server: s}
	counter := newConstCounter()
	degraded := failmode.NewDegradedCounters()
	rec := failmode.NewReconciler(db, counter, degraded, logger)
	gov := governance.NewGovernanceStore(counter, failmode.NewStore(db), degraded, rec,
		failmode.Params{
			Mode:             failmode.ModeTieredHybrid,
			PGFreshness:      5 * time.Minute,
			ExpectedReplicas: 1,
		}, logger)
	// The reconciler is bound to a cancellable context, unlike the real
	// composition root, which runs for the life of the process. It never has
	// work here: the fake counter's breaker is always closed and the fake
	// transaction yields no outage rows. It still needs stopping, because a
	// test that builds many Servers otherwise leaks one goroutine per Server.
	sweepCtx, stopSweep := context.WithCancel(context.Background())
	gov.Start(sweepCtx)

	router := preflight.NewMockRouter(preflight.MockRouterConfig{
		EmbeddingResponse: cannedEmbedding(),
	})

	// An EMPTY identity secret. verifySignature returns true without one, so
	// the driver needs no HMAC on the Python side and the SDK's own headers are
	// enough. Production sets GATEWAY_IDENTITY_SECRET and this harness is not
	// production.
	handler := llmproxy.NewHandler(router, logger, nil,
		llmproxy.WithBudgetGate(gov, cost.New(cost.Config{})))

	mux := http.NewServeMux()
	mux.HandleFunc("/__harness/verdict", s.handleVerdict)
	mux.HandleFunc("/__harness/journal", s.handleJournal)
	mux.Handle("/", s.edgeShim(api.NewRouter(handler)))
	s.handler = mux
	s.stop = stopSweep
	return s, nil
}

// Close stops the reconciler's sweep loop. It is safe to call more than once.
//
// Every New starts one sweep goroutine. Without Close it runs for the life of
// the process, so a suite that builds many Servers leaks one goroutine each.
// The equivalent fixture one directory up (internal/preflight/harness.go)
// already cancels its context through t.Cleanup; this is the same contract for
// callers that are not holding a *testing.T.
func (s *Server) Close() {
	if s.stop != nil {
		s.stop()
	}
}

// Handler is the assembled http.Handler, ready for http.Serve or httptest.
func (s *Server) Handler() http.Handler { return s.handler }

// Verdict reports the verdict the harness currently answers with.
func (s *Server) Verdict() Verdict {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	return s.verdict
}

// SetVerdict switches the budget answer. An unknown value is rejected rather
// than defaulted: a silent default would make the member-402 assertion pass
// against an allow-verdict server.
func (s *Server) SetVerdict(v Verdict) error {
	for _, known := range Verdicts {
		if v == known {
			s.stateMu.Lock()
			s.verdict = v
			s.stateMu.Unlock()
			return nil
		}
	}
	return fmt.Errorf("sdkharness: unknown verdict %q; want one of %v", v, Verdicts)
}

// Journal returns a copy of the recorded requests.
func (s *Server) Journal() []JournalEntry {
	s.journalMu.Lock()
	defer s.journalMu.Unlock()
	out := make([]JournalEntry, len(s.journal))
	copy(out, s.journal)
	return out
}

// ResetJournal drops every recorded request.
func (s *Server) ResetJournal() {
	s.journalMu.Lock()
	s.journal = nil
	s.journalMu.Unlock()
}

// ── The control surface ──────────────────────────────────────────────────────

// handleVerdict is the control endpoint. It is a POST rather than a start-up
// environment variable for three reasons:
//
//  1. No new environment variable enters the gateway module. The env-drift gate
//     compares every name the code under internal/ reads against what the Helm
//     chart can set, and a harness-only name would have to be allowlisted in a
//     PRODUCTION allowlist or given a values.yaml key no deployment uses.
//  2. One process answers all three verdicts. With an environment variable the
//     driver must start three processes and pick up three ports; every one of
//     those handshakes is a chance to assert a member-402 expectation against
//     a server that was started for `allow` and read the resulting 200 as an
//     honest answer.
//  3. The response echoes the verdict that was APPLIED, so the driver asserts
//     that the switch happened instead of assuming it.
func (s *Server) handleVerdict(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeHarnessJSON(w, http.StatusMethodNotAllowed,
			map[string]string{"error": "POST a JSON body {\"verdict\": \"...\"}"})
		return
	}
	var body struct {
		Verdict Verdict `json:"verdict"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeHarnessJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := s.SetVerdict(body.Verdict); err != nil {
		writeHarnessJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeHarnessJSON(w, http.StatusOK, map[string]string{"verdict": string(s.Verdict())})
}

// handleJournal serves the recorded requests (GET) or clears them (DELETE).
func (s *Server) handleJournal(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeHarnessJSON(w, http.StatusOK, map[string]any{"data": s.Journal()})
	case http.MethodDelete:
		s.ResetJournal()
		writeHarnessJSON(w, http.StatusOK, map[string]any{"data": []JournalEntry{}})
	default:
		writeHarnessJSON(w, http.StatusMethodNotAllowed,
			map[string]string{"error": "GET to read, DELETE to clear"})
	}
}

func writeHarnessJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

// ── The edge shim ────────────────────────────────────────────────────────────

// headerOpenAIOrganization is the project selector elitea-main accepts and the
// SDK sends (openai_organization on ChatOpenAI/OpenAIEmbeddings, and the
// lower-case default_headers entry on ChatAnthropic; HTTP header names are
// case-insensitive, so http.Header.Get finds either).
const headerOpenAIOrganization = "OpenAI-Organization"

// edgeShim records the inbound request, derives the gateway identity headers
// from it, and passes it to the real router.
func (s *Server) edgeShim(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sent := snapshotHeaders(r.Header)
		probe := s.probeBody(r)

		// The project the SDK selected, verbatim. It is NOT replaced with the
		// configured ProjectID: a driver that stopped sending the header must
		// see the gateway admit every request, not see this file paper over it.
		org := r.Header.Get(headerOpenAIOrganization)
		if org != "" {
			r.Header.Set("X-Elitea-Project-Id", org)
			// elitea-main attributes the call to the authenticated member. The
			// SDK carries no member header, so the shim supplies it; without a
			// member id the gateway admits at the member ceiling and the
			// member-402 verdict could never be produced.
			r.Header.Set("X-Elitea-User-Id", strconv.Itoa(s.cfg.UserID))
		}

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		s.journalMu.Lock()
		s.journal = append(s.journal, JournalEntry{
			Method:  r.Method,
			Path:    r.URL.Path,
			Status:  rec.status,
			Verdict: string(s.Verdict()),
			Headers: sent,
			Body:    probe,
		})
		s.journalMu.Unlock()
	})
}

// probeBodyLimit bounds what the journal reads out of a request body. A
// harness that buffered an unbounded body would turn a large multimodal payload
// into a memory fault far away from the assertion that caused it.
const probeBodyLimit = 1 << 20 // 1 MiB

// bodyProbeFields are the only names copied into the journal. A whole-body
// record would put prompts and, one day, credentials into a GET endpoint; these
// three are the ones a driver assertion can be written against.
var bodyProbeFields = []string{"model", "encoding_format", "stream"}

// probeBody reads the named scalar fields out of a JSON request body and
// RESTORES the body so the real handler still sees it. A body that is not JSON,
// is empty, or is over the limit is skipped and recorded as absent — the driver
// must fail on a missing record rather than read the absence as agreement.
func (s *Server) probeBody(r *http.Request) map[string]any {
	if r.Body == nil || r.Method != http.MethodPost {
		return nil
	}
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		return nil
	}
	// Read ONE byte past the limit, so an over-limit body is detectable rather
	// than silently truncated at exactly the limit.
	raw, err := io.ReadAll(io.LimitReader(r.Body, probeBodyLimit+1))
	if err != nil {
		return nil
	}
	// The handler has not read the body yet, so put it back before returning.
	// Splice rather than replace: replacing r.Body with the bytes read here
	// TRUNCATED any body over the limit and handed the corrupt prefix to the
	// real router, which accepts 32 MiB (llmproxy.maxRequestBody). That made
	// this harness 32x stricter than the router it exists to serve faithfully.
	// MultiReader gives the handler the whole body back; the journal still
	// buffers at most probeBodyLimit+1.
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(raw), r.Body), r.Body}
	if len(raw) > probeBodyLimit {
		// Over the limit: the body reaches the handler intact, but this probe
		// records nothing rather than decoding a truncated prefix.
		return nil
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil
	}
	out := make(map[string]any, len(bodyProbeFields))
	for _, name := range bodyProbeFields {
		if v, ok := decoded[name]; ok {
			out[name] = v
		}
	}
	return out
}

// snapshotHeaders copies the inbound headers, with the Authorization VALUE
// replaced. The gateway does not authenticate — elitea-main does — so the token
// is not what tier 2 measures, and a journal endpoint that echoes bearer tokens
// is a pattern worth not establishing even in a harness.
//
// The names are LOWERCASED. net/http stores them under Go's own canonical form,
// which turns "OpenAI-Organization" into "Openai-Organization"; a driver that
// looked the name up as the SDK spells it would find nothing and report a
// missing header for a header that arrived. HTTP header names are
// case-insensitive, so one fixed case is the honest record.
func snapshotHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(h))
	for name, values := range h {
		key := strings.ToLower(name)
		if key == "authorization" {
			if len(values) > 0 && values[0] != "" {
				out[key] = "<present>"
			}
			continue
		}
		out[key] = strings.Join(values, ", ")
	}
	return out
}

// statusRecorder captures the status the real router wrote. It forwards
// Flush so the SSE path keeps streaming incrementally: llmproxy's stream writer
// requires an http.Flusher and degrades when it cannot find one.
type statusRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

func (r *statusRecorder) WriteHeader(status int) {
	if !r.written {
		r.status = status
		r.written = true
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	r.written = true
	return r.ResponseWriter.Write(b)
}

func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack forwards the connection takeover the realtime route performs. A
// wrapper that does not forward it makes /llm/v1/realtime fail with "response
// writer does not support hijacking" — a message about this file, for a route
// whose real errors are already hard to read.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("sdkharness: the underlying %T cannot hijack", r.ResponseWriter)
	}
	r.written = true
	return h.Hijack()
}

// ── The budget tiers ─────────────────────────────────────────────────────────

// verdictDB is the Postgres tier. It answers the snapshot point-read with a
// hard limit chosen from the CURRENT verdict and the scope of the read, so one
// process can produce all three answers.
type verdictDB struct{ server *Server }

// hardLimitFor is the whole verdict table.
//
// The spend is a constant (seededSpendNano); only the ceiling moves. A ceiling
// under the spend makes failmode.Decide's NATS_HEALTHY branch return Block402,
// which is the branch production uses.
func (d *verdictDB) hardLimitFor(scope string) int64 {
	switch d.server.Verdict() {
	case VerdictProject402:
		if scope == failmode.ScopeProject {
			return limitBelowSpend
		}
		return limitAboveSpend
	case VerdictMember402:
		if scope == failmode.ScopeUser {
			return limitBelowSpend
		}
		return limitAboveSpend
	case VerdictAllow:
		return limitAboveSpend
	default:
		return limitAboveSpend
	}
}

// QueryRow answers failmode.Store.ReadSnapshot. The scope is argument 2 in both
// snapshotSQL and userSnapshotSQL; a shorter argument list means the store was
// restructured and this fake can no longer tell the two ceilings apart, so it
// reports an error instead of guessing.
func (d *verdictDB) QueryRow(_ context.Context, _ string, args ...any) failmode.Row {
	if len(args) < 2 {
		return errRow{fmt.Errorf(
			"sdkharness: snapshot read has %d argument(s); the scope used to be the "+
				"second. This fake cannot tell the project ceiling from the member one "+
				"any more", len(args))}
	}
	scope, ok := args[1].(string)
	if !ok {
		return errRow{fmt.Errorf("sdkharness: snapshot argument 2 is %T, not the scope string", args[1])}
	}
	return snapshotRow{
		hardLimitNano: d.hardLimitFor(scope),
		accumNano:     seededSpendNano,
		softAlertPct:  harnessSoftAlertPct,
	}
}

// Begin gives the reconciler a transaction that finds no outage rows.
func (d *verdictDB) Begin(_ context.Context) (failmode.Tx, error) { return nopTx{}, nil }

var _ failmode.DB = (*verdictDB)(nil)

// snapshotRow scans in failmode.Store.ReadSnapshot's exact column order:
// is_unlimited, hard_limit_nano, accumulated_nano, soft_alert_pct,
// nats_fail_mode, acc_found, age_seconds, soft_alerts_disabled.
type snapshotRow struct {
	hardLimitNano int64
	accumNano     int64
	softAlertPct  int
}

func (r snapshotRow) Scan(dest ...any) error {
	values := []any{
		false,           // is_unlimited
		r.hardLimitNano, // hard_limit_nano
		r.accumNano,     // accumulated_nano
		r.softAlertPct,  // soft_alert_pct
		nil,             // nats_fail_mode (SQL NULL ⇒ inherit the baseline)
		true,            // acc_found
		float64(0),      // age_seconds — a fresh snapshot
		false,           // soft_alerts_disabled
	}
	if len(dest) != len(values) {
		return fmt.Errorf(
			"sdkharness: the snapshot read scans %d column(s), this fake supplies %d. "+
				"failmode.Store.ReadSnapshot changed shape", len(dest), len(values))
	}
	for i, v := range values {
		if err := assign(dest[i], v); err != nil {
			return fmt.Errorf("sdkharness: snapshot column %d: %w", i, err)
		}
	}
	return nil
}

func assign(dest, v any) error {
	switch p := dest.(type) {
	case *bool:
		p2, ok := v.(bool)
		if !ok {
			return fmt.Errorf("want bool, have %T", v)
		}
		*p = p2
	case *int64:
		p2, ok := v.(int64)
		if !ok {
			return fmt.Errorf("want int64, have %T", v)
		}
		*p = p2
	case *int:
		p2, ok := v.(int)
		if !ok {
			return fmt.Errorf("want int, have %T", v)
		}
		*p = p2
	case *float64:
		p2, ok := v.(float64)
		if !ok {
			return fmt.Errorf("want float64, have %T", v)
		}
		*p = p2
	case **string:
		if v == nil {
			*p = nil
			return nil
		}
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("want string or nil, have %T", v)
		}
		*p = &s
	default:
		return fmt.Errorf("unsupported destination %T", dest)
	}
	return nil
}

// errRow reports a scan error, which the store turns into a fail-closed 503.
type errRow struct{ err error }

func (r errRow) Scan(...any) error { return r.err }

// nopTx is a transaction with no outage rows. The reconciler's recovery pass
// completes over it without touching the counter.
type nopTx struct{}

func (nopTx) QueryRow(_ context.Context, sql string, args ...any) failmode.Row {
	// Issue #515: the outage-window write claims its event id first.
	if strings.Contains(sql, "processed_event_ids") && len(args) > 0 {
		if id, ok := args[0].(string); ok {
			return idRow{id}
		}
	}
	return errRow{errors.New("sdkharness: nopTx has no scripted row for this query")}
}
func (nopTx) Query(_ context.Context, _ string, _ ...any) (failmode.Rows, error) {
	return emptyRows{}, nil
}
func (nopTx) ExecAffected(_ context.Context, _ string, _ ...any) (int64, error) { return 1, nil }
func (nopTx) Commit(_ context.Context) error                                    { return nil }
func (nopTx) Rollback(_ context.Context) error                                  { return nil }

type idRow struct{ id string }

func (r idRow) Scan(dest ...any) error {
	if len(dest) != 1 {
		return fmt.Errorf("sdkharness: event-id claim scans %d column(s), want 1", len(dest))
	}
	return assign(dest[0], r.id)
}

type emptyRows struct{}

func (emptyRows) Next() bool          { return false }
func (emptyRows) Scan(_ ...any) error { return errors.New("sdkharness: no rows") }
func (emptyRows) Err() error          { return nil }
func (emptyRows) Close()              {}

// constCounter is the NATS tier. ReadBudget answers seededSpendNano for EVERY
// subject, so the harness never reconstructs the gateway's billing-period
// subject arithmetic. Reconstructing it in a second place is a real hazard: a
// subject that does not match seeds nothing, reads back zero, and admits the
// request — a false pass on the 402 assertions.
type constCounter struct {
	mu     sync.Mutex
	deltas map[string]int64
}

func newConstCounter() *constCounter { return &constCounter{deltas: map[string]int64{}} }

func (c *constCounter) ReadBudget(_ context.Context, subject string) (int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return seededSpendNano + c.deltas[subject], nil
}

func (c *constCounter) IncrBudget(_ context.Context, subject string, delta int64) (int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.deltas[subject] += delta
	return seededSpendNano + c.deltas[subject], nil
}

func (c *constCounter) IncrBudgetIdempotent(_ context.Context, subject, _ string, delta int64) (int64, bool, error) {
	total, err := c.IncrBudget(context.Background(), subject, delta)
	return total, true, err
}

func (c *constCounter) PublishDelta(_ context.Context, _ string, _ []byte) error { return nil }
func (c *constCounter) TryAlertCooldown(_ context.Context, _ string) (bool, error) {
	return false, nil
}
func (c *constCounter) OnBreakerStateChange(_ func(from, to gobreaker.State)) {}
func (c *constCounter) BreakerState() gobreaker.State                         { return gobreaker.StateClosed }
func (c *constCounter) BudgetSubject(scope, scopeID string, periodStartUnix int64) string {
	return natspkg.BudgetSubject(scope, scopeID, periodStartUnix)
}

var _ failmode.Counter = (*constCounter)(nil)

// ── The canned embedding ─────────────────────────────────────────────────────

// cannedEmbedding builds the response the embeddings route answers with.
//
// The vector is carried as a BASE64 STRING, not as a float array, because that
// is what a real provider answers when the request asks for it — and
// openai-python asks for it whenever the caller omits encoding_format, which
// LangChain's OpenAIEmbeddings does. A float array here would make the driver's
// embedding assertion pass without ever exercising the base64 decode.
func cannedEmbedding() *schemas.BifrostEmbeddingResponse {
	encoded := base64Float32LE(rampVector(embeddingDim))
	return &schemas.BifrostEmbeddingResponse{
		Object: "list",
		Model:  "openai/text-embedding-3-small",
		Data: []schemas.EmbeddingData{{
			Index:     0,
			Object:    "embedding",
			Embedding: schemas.EmbeddingStruct{EmbeddingStr: &encoded},
		}},
		Usage: &schemas.BifrostLLMUsage{PromptTokens: 4},
	}
}

// rampVector returns a vector with distinct, non-zero values. A constant vector
// would normalise to the same thing whatever its width, and a zero vector makes
// LangChain's per-chunk averaging produce NaN rather than a readable failure.
func rampVector(n int) []float32 {
	out := make([]float32, n)
	for i := range out {
		out[i] = float32(i+1) / float32(n)
	}
	return out
}

// discard drops handler logs.
type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }
