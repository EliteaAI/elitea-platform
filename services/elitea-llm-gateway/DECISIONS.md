# DECISIONS — elitea-llm-gateway

Standing decisions for the LLM gateway, with rationale. `CLAUDE.md` is the terse
agent-facing version of these; this file is the human-readable "why". Each entry
records a decision so it is not re-litigated on every PR. Items marked **[human
decision]** are risk/policy calls an autonomous agent must NOT change without sign-off.

## Money
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

## Known follow-ups (not blocking, need a human)
- Set `secrets.*.optional: false` in a production values overlay so a missing
  Secret fails the pod instead of running degraded (identity HMAC bypassable /
  vault single-level). Left `true` in the base chart for local/dev.
- elitea-main env-drift is WARN-only (chart sets 7, code reads 30+ via external
  secrets); tightening it is a separate effort.
