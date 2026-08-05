# DECISIONS — elitea-llm-gateway

Standing decisions for the LLM gateway, with rationale. `CLAUDE.md` is the terse
agent-facing version of these; this file is the human-readable "why". Each entry
records a decision so it is not re-litigated on every PR. Items marked **[human
decision]** are risk/policy calls an autonomous agent must NOT change without sign-off.

## Money
- **Only the TERMINAL stream event carries authoritative usage.** bifrost maps
  Anthropic's `message_start` to `response.created`, and that event already
  carries usage (input tokens, `output_tokens: 1`). Accepting usage from any
  event made a mid-stream disconnect bill "input + 1 token" as authoritative AND
  suppress the `budget.unbilled_stream` loss event — an invisible underbill
  across the whole `/llm/v1/messages` dialect, strictly worse than the visible
  loss issue #9 set out to fix. `responsesUsageFromChunk` therefore accepts
  usage only from `response.completed` / `.incomplete` / `.failed`.
- **int64 nano-USD, no float on the money path.** Rationale: float rounding drift
  across the incr → delta → Postgres write-behind hops corrupts billing; integers
  are exact. Prices are per-1M tokens (a per-1k reading is a 1000× overcharge).

## Enforcement
- **[human decision] Fail CLOSED on budget-store/PG error while NATS is up.**
  Chosen 2026-07-23 over fail-open. Rationale: this is a metered spend surface; a
  transient DB read failure returning an "unlimited" snapshot would let spend run
  unbounded. We accept returning 503 during a DB blip over granting free spend.
  Reconsider only if availability SLOs make brief 503s unacceptable AND a safer
  bound exists.
- **[human decision] Async-billing concurrent-admission overshoot is a bounded,
  accepted trade-off.** Billing moved off the HTTP critical path (latency); the
  window where N concurrent requests pass admission before the counter updates is
  bounded by an in-flight reservation. The residual overshoot is accepted for the
  latency win. Revisit if a project can materially exceed budget under burst.
- Every /llm endpoint is gated + billed uniformly (no per-endpoint exceptions).
- **[human decision] 2026-08-05 — Streamed spend on client disconnect: bounded
  grace, authoritative usage only.** *Finding:* streams billed only from the
  final usage chunk, so any early exit (client disconnect, mid-stream provider
  error, failed stream setup) left the whole response unbilled — a reachable
  hard-budget bypass (issue #9). *Decision:* build the streaming provider
  context with `context.WithoutCancel(r.Context())` and an owned cancel, so the
  provider stream survives a client disconnect for a bounded grace period
  (`LLM_STREAM_GRACE_MS`, default 5 s, clamped ≤15 s, 0 = disabled) during which
  a detached drain may still capture the authoritative usage trailer. If no
  trailer arrives, **nothing is billed** and a `budget.unbilled_stream` event is
  emitted on gateway.events.*. *Rationale:* the free-inference lever is only
  valuable to a client that already received nearly all the output, which is
  exactly when the trailer is closest — so a short grace covers the exploitable
  window. An observed-output-bytes estimate was explicitly REJECTED: it would
  put a `bytes/4` heuristic on the money path (contradicting the reservation-only
  rule below), over-bill inline-base64 multimodal by orders of magnitude, and
  fire on clean completions the loop cannot distinguish from disconnects.
  Out-of-band provider usage lookup was rejected as unavailable in practice
  (no per-request usage API on Anthropic/Bedrock/Vertex/Ollama/vLLM; OpenAI-only
  and minutes late). *Accepted cost:* a client that disconnects — including a
  user pressing Stop — may be billed for up to the grace period of further
  generation, charged to that project's own provider credential. Concurrent
  drains are bounded (`LLM_STREAM_DRAIN_MAX_INFLIGHT`) and shutdown cuts them
  loose so the pod's termination grace is never held hostage to the stream grace
  (see the two-phase drain entry below). The loss event is operator-only.
- **[human decision] 2026-08-05 — Drain-pool saturation fails to a SHORT grace,
  never to "bill nothing"; slots are bounded per project.** *Finding:* the first
  cut of the above dropped a saturated drain straight to grace=0, destroying a
  trailer that is usually milliseconds away — reopening the same fail-open hole
  on a single global counter any one tenant could exhaust (gateway-review).
  *Decision:* a drain that cannot take a slot gets `SaturatedStreamGrace`
  (500 ms) instead of zero, and the pool is bounded per project
  (limit/8, floor 1) as well as globally. The loss event reports
  `drain_saturated` — and `drain_saturated/<what actually happened>` when the
  short grace was still not enough — so saturation is alarmable before it costs
  money. *Rationale:* the resource being protected is a provider socket that is
  about to close anyway; refusing new streaming admissions instead (fail closed
  at the gate) turns a billing edge case into an availability event, which is
  the worse trade at this severity.
- **[human decision] 2026-08-05 — Shutdown is a THREE-phase sequence over a
  split server lifecycle.** *Finding (round 2):* the two-phase version below was
  still wrong in sequence. `srv.Shutdown` closed NATS as its last step, so
  moving the billing drain after it sent every increment to a dead connection
  (diverted to the outage-delta path, which recovery only sweeps on a breaker
  CLOSED transition that never fires while NATS is healthy); the `os.Exit(1)` on
  a shutdown error then sat between the two, skipping the drains exactly when
  they matter; and drains spawned after phase 1 were left off the wait group, so
  every drain on the shutdown path was skipped (reproduced: 0 increments, 5/5).
  *Decision:* split `Server.Shutdown` into `ShutdownHTTP` (HTTP + core, NATS
  stays UP) and `Close` (NATS), and run
  `StopStreamGrace → ShutdownHTTP → DrainBilling → govStore.Drain → Close`.
  Billing is open and NATS is live throughout the window in which streams
  actually settle. A failed HTTP shutdown no longer aborts the drains.
  `terminationGracePeriodSeconds` is raised to 180 so the post-HTTP phases have
  headroom over the 150 s drain budget. `TestShutdownSequence` asserts the
  ORDER BY EXECUTING it — the previous textual guard compared source positions
  and could not see the `os.Exit` between two calls.
- **[human decision] 2026-08-05 — (superseded by the entry above) Shutdown is a
  two-phase drain, and a refused billing increment is metered.** *Finding:* `drainForShutdown` ran BEFORE
  `srv.Shutdown`, so `billingClosing` was set while SSE handlers were still
  live; a drain that had recovered the authoritative trailer had its increment
  refused and — because usage WAS known — no loss event was emitted either.
  Reproduced on the deploy path: 231000 nano-USD lost, 0 UpdateUsage calls, 0
  events. *Decision:* split shutdown into `StopStreamGrace()` (phase 1, before
  `srv.Shutdown`: drains stop waiting for trailers, billing stays open) and
  `DrainBilling()` (phase 2, after: waits for drains on their own WaitGroup,
  THEN closes billing and waits for billing goroutines). Independently, when an
  increment is refused with usage in hand, publish `budget.unbilled_stream` with
  reason `billing_refused`. *Rationale:* the two halves of the old
  `DrainBilling` had opposite timing requirements; and known spend must never
  disappear into a lone WARN. The metering half stands; only the ordering was
  superseded. A refused increment is reported as `billing_refused`, which is
  raised ONLY for a genuine drop — "no gate wired", "no resolvable project" and
  "zero-priced model" are `billNotBillable` and stay silent, or the one alarm
  that detects real loss drowns in noise.
- **[human decision] 2026-08-05 — `budget.unbilled_stream` is operator-only.**
  It publishes to `gateway.events.ops.budget` via a separate `OpsEventPublisher`
  port, NOT the per-project subject elitea-main relays to project members.
  *Rationale:* `budget.soft_alert` is tenant-facing by design, but telling a
  tenant in real time which of their streams the gateway failed to bill is an
  oracle for the conditions that produce it.

## Trust boundary
- **[human decision] Deny-by-default trusted-proxy model.** `X-Auth-*` identity
  headers are honored only from `TRUSTED_PROXY_CIDRS` (matched on RemoteAddr, not
  the spoofable X-Forwarded-For); empty config = trust nothing. The edge strips
  all client-supplied auth material before proxying. Rationale: without the CIDR
  gate, any pod with network reach could assert an arbitrary project identity.
  Operators MUST set TRUSTED_PROXY_CIDRS to their ingress range.

## Topology / build
- Gateway is a standalone Go 1.26.4 module, deliberately OUT of the root go.work
  (which stays 1.25.8 for elitea-main/scheduler). Build with GOWORK=off. Rationale:
  bumping the workspace floor to 1.26.4 broke elitea-main/scheduler CI lint on the
  1.25 runner (learned the hard way in review round 1's fix).

## Prevention gates (CI)
- Three enforcing gates guard the classes that recurred in review:
  1. **Wiring gate** (`cmd/.../main_test.go:TestMainWiring`) — lifecycle methods
     must be called from main.
  2. **Env-drift gate** (`scripts/env-drift-check.sh`) — code env reads must be
     chart-settable or allowlisted.
  3. **Coverage floor** (`scripts/coverage-floor.sh`) — enforcement packages must
     not regress below current coverage.

## Resolved follow-ups
- ✅ `SECRETS_MASTER_KEY` + `GATEWAY_IDENTITY_SECRET` now wired via the chart's
  `secrets:` block (valueFrom.secretKeyRef, optional:true default) — provision the
  `elitea-llm-gateway-secrets` Secret out-of-band. env-drift gate updated to read
  `.secrets` keys; allowlist entries removed.
- ✅ `internal/llmproxy` coverage raised 84.2% → 91.5% (coverage_boost_test.go);
  coverage-floor bumped to 85.
- ✅ `/llm/v1/messages/count_tokens` now budget-gated (was the 4th "unmetered path"
  found — by dogfooding the saved gateway-review workflow on PR#6, after 3 manual
  rounds missed it). `checkBudget(...,0)` before `CountTokensRequest`; no updateUsage
  (count_tokens has no billable usage). Guarded by TestBudgetGate_CountTokens_Block402.
- ✅ Wiring gate now guards `llmproxy.WithBudgetGate(` — the point that attaches the
  gate to the handler was the single most critical UNasserted wiring; mutation-verified.
- ✅ env-drift regex `[a-zA-Z]+Or` → `[a-zA-Z0-9]+Or` (was blind to `uint32Or`, so the
  `LLM_BUDGET_CB_*` vars were silently skipped); CB vars added to values.yaml.
- ✅ (elitea-platform storage-migration-plan.md S17) env-drift-check.sh's own
  `_test.go` exclusion was a no-op: `grep -rho` strips filenames before the
  next stage's `grep -v '_test.go'` filter ever sees them, so every
  integration-test-only env var (e.g. `ELITEA_TEST_DATABASE_URL`) was
  misreported as a production FAIL for BOTH services. Fixed by dropping `-h`.
  Also added detection for elitea-main's `lookup("VAR")`-parameter indirection
  (storage.ConfigFromEnv's injectable-lookup pattern, distinct from the
  existing `fooEnv = "VAR"` const-indirection case), which no existing
  pattern matched — every var read that way was misreported as dead chart
  config. elitea-main's chart now wires the S17 storage vars (S2/S5/S12) for
  real and the allowlist was trimmed to match; the check now also runs as
  its own `env-drift` job in `ci-go.yml` (previously it was only reachable
  via `ci-gateway.yml`'s path-scoped trigger, which never fires for an
  elitea-main-only or chart-only change — see the next line).

## Known follow-ups (not blocking, need a human)
- Set `secrets.*.optional: false` in a production values overlay so a missing
  Secret fails the pod instead of running degraded (identity HMAC bypassable /
  vault single-level). Left `true` in the base chart for local/dev.
- elitea-main env-drift is still WARN-heavy for vars read via a default
  (`ELITEA_RUNTIME_ENABLED`, `REDIS_URL`, and ~19 others) with no chart
  override knob at all — real, now-visible (the two bugs above previously
  hid most of it), and left as accepted debt: wiring 20+ unrelated knobs
  into values.yaml was out of scope for the storage-migration work that
  surfaced this. WARN does not fail CI.
