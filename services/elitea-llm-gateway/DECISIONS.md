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
- **[human decision] 2026-08-09 (supersedes the entry below) — the
  concurrent-admission overshoot is UNBOUNDED and accepted; the in-flight
  reservation is deleted.** *Finding (issue #10):* the reservation that the
  entry below claimed as the bound never existed in practice. All nine
  `checkBudget` call sites passed `promptTokenEst=0`, so the `+reservation`
  increment was unreachable, while the billing path decremented
  unconditionally — the counter only ever drifted negative and its `sync.Map`
  entries were never reaped (unbounded growth per project+period).
  *Decision:* delete the mechanism, its counter and its claims rather than
  repair it. Bounding the overshoot for real needs a pre-flight token
  estimator, and no estimate may reach a billed amount (the money-path rule
  below); nobody has asked for concurrent admission control. `checkBudget` now
  passes `reqCostNano=0` explicitly. *Accepted cost:* under burst, N concurrent
  requests can each be admitted against the same not-yet-updated NATS counter;
  the overshoot is bounded only by burst size × per-request cost. The NATS
  counter remains ground truth and the hard 402 still fires once it updates.
  Revisit — with a real estimator — if a project can materially exceed budget
  under burst in practice.
- **[human decision] (SUPERSEDED 2026-08-09 by the entry above — the bound it
  claims was never wired) Async-billing concurrent-admission overshoot is a
  bounded, accepted trade-off.** Billing moved off the HTTP critical path
  (latency); the window where N concurrent requests pass admission before the
  counter updates was said to be bounded by an in-flight reservation. The
  residual overshoot is accepted for the latency win.
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
  put a `bytes/4` heuristic on the money path (no estimate may ever reach a
  billed amount), over-bill inline-base64 multimodal by orders of magnitude, and
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
  `ShutdownHTTP → StopStreamGrace → DrainBilling → govStore.Drain → Close`.
  Billing is open and NATS is live throughout the window in which streams
  actually settle. A failed HTTP shutdown no longer aborts the drains.
  `terminationGracePeriodSeconds` is raised to 180 so the post-HTTP phases have
  headroom over the 150 s drain budget.
  **StopStreamGrace MUST NOT be hoisted above ShutdownHTTP** (round 3): it both
  sets `drainsClosing` and closes the `drainClosing` channel, so running it
  first gives every stream disconnecting during the ~150 s HTTP drain `grace=0`
  and cuts every parked drain — turning disconnect billing OFF for the whole
  duration of every rolling deploy, i.e. reopening the issue-#9 bypass. That
  regression shipped once and was invisible to a test whose SSE loop observed
  the usage chunk before the failing write, so the drain never participated.
  Drains are detached goroutines, not HTTP requests, so leaving the grace armed
  does not extend `ShutdownHTTP` at all. `TestShutdownSequence` asserts the
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

- **[human decision] 2026-08-09 — "Circular-routing guard #2" is an
  amplification backstop, not a loop detector; its numbers are operator
  settings (issue #12, INTERIM).** The implementation does no hop detection at
  all — it counts requests per (project_id, model). At the spec'd 5/1s/30s it
  was a hardcoded 5 req/s rate limiter armed in production; a 50-VU k6 run
  against one tuple measured 99.96% HTTP 429, so the breaker, not the gateway,
  was what the overhead gate measured.
  The load-bearing finding: **no rate threshold can separate a routing loop
  from legitimate traffic here**, because both are bounded by the same
  per-replica provider worker pool. Low enough to catch the canonical loop is
  low enough to trip ordinary bursts; high enough not to trip bursts can never
  fire on the loop. So the layer is now named and tuned for what it measurably
  is.
  Numbers: threshold 1000 (`LLM_LOOP_BREAKER_THRESHOLD`), window 1 s, open 5 s
  (was 30 s). 1000 = provider worker pool (50) ÷ fastest realistic call latency
  (~50 ms embeddings) — the ceiling of what one replica could ever serve for one
  tuple. Worst case permitted: 1000 req/s per tuple per replica × replicas,
  sustained, versus the old 5 — accepted deliberately, because the old number's
  containment was illusory while its false positives were measured. A negative
  threshold disarms it; either way `logLoopBreakerMode` states the mode at
  startup, so it can never quietly pretend to be armed.
  Guarded by `TestLoopBreaker_DefaultDoesNotTripOrdinaryBurst`,
  `TestLoopBreaker_DefaultStillContainsRunawayAmplification`,
  `TestLoopBreaker_OperatorParamsApply` and the `logLoopBreakerMode(` wiring-gate
  entry; all mutation-verified 2026-08-09.
  **NOT done here, tracked as follow-up:** hop-marker detection (the actual
  mechanism), and amending spec §2.6 + `runbook-bifrost-cutover.mdx`, which
  still document 5/1s/30s and now disagree with the code — those live in
  `elitea-docs`, a different repository.

## Trust boundary
- **[human decision] Deny-by-default trusted-proxy model.** `X-Auth-*` identity
  headers are honored only from `TRUSTED_PROXY_CIDRS` (matched on RemoteAddr, not
  the spoofable X-Forwarded-For); empty config = trust nothing. The edge strips
  all client-supplied auth material before proxying. Rationale: without the CIDR
  gate, any pod with network reach could assert an arbitrary project identity.
  Operators MUST set TRUSTED_PROXY_CIDRS to their ingress range.
- **[human decision] 2026-08-09 — `GATEWAY_IDENTITY_SECRET` is REQUIRED, and a
  default install without it does NOT boot (issue #11).** The old startup guard
  fired only when `GATEWAY_NATS_URL` was set, but the vault-backed Account is
  wired on `pool != nil`. `verifySignature` treats an empty secret as
  "verification disabled" and returns true, so a NATS-less deployment with a
  database took `X-Elitea-Project-Id` at face value and used *that* project's
  decrypted Fernet-vault provider credentials — unauthenticated cross-tenant
  credential use. The guard now also covers the Account path
  (`startupIdentityCheck`, `cmd/elitea-llm-gateway/main.go`), FATAL + exit(1)
  before `server.New` creates a listener.
  **Consequence, chosen deliberately over the alternatives:** `DATABASE_URL` has
  a non-empty default and `pgxpool.New` only parses the DSN (it never dials), so
  `credentialAccount` is true in effectively every deployment — the secret is now
  unconditionally required in practice. The chart therefore flips
  `secrets.GATEWAY_IDENTITY_SECRET.optional` to `false` in BOTH
  `deploy/helm/elitea-llm-gateway` and `deploy/helm/elitea-main` (the two sides
  must carry the same value; the edge signs what the gateway verifies). A
  `helm install` with no `identity-secret` key now fails at container creation
  with a message naming the Secret, instead of silently starting a gateway that
  hands any caller any tenant's credentials. Dev/compose/CI runs must set
  `GATEWAY_IDENTITY_SECRET` to any non-empty value.
  Rejected alternatives: (a) keep booting and merely drop the credential-backed
  Account — a silent, hard-to-diagnose loss of all provider calls that still
  leaves budget identity unverified; (b) keep `optional: true` and let the
  binary crash-loop — same outcome, worse diagnostics.
  Guarded by `TestStartupIdentityCheck` + the `startupIdentityCheck(` entry in
  `TestMainWiring`; both mutation-verified 2026-08-09.

- **[human decision] 2026-08-09 — Tenant-authored `api_base` may reach a private
  network ONLY through an operator egress allowlist (issue #13).** The previous
  `AllowPrivateNetwork = true` carve-out for the vLLM/Ollama classes was
  unconditional, and the URL those classes dial comes from the tenant's own
  `p_{id}.configuration` row — so any user who could author a credential could
  make the gateway open a connection to any address the pod can reach. Two
  modes now, and deliberately no third:
  - `GATEWAY_EGRESS_ALLOWLIST` empty (default): hosts unrestricted, but
    bifrost's SSRF-safe dialer stays armed for EVERY provider class. No tenant
    can reach RFC-1918. **Self-hosted vLLM/Ollama on a private network stops
    working until an operator opts in** — that is the accepted cost.
  - non-empty: every `api_base` must match an entry, and private destinations
    become reachable for the self-hosted classes only.
  It is a HOST-NAME allowlist, not an IP-range check, on purpose: an IP check
  here would be a check-then-dial race (DNS rebinding), whereas a name the
  operator sanctioned is sanctioned whatever it resolves to, and the dialer's
  own check happens at connect time with no race. The check runs BEFORE
  `vault.Resolve`, so a non-allowlisted destination never causes a decrypt of
  the tenant's `{{secret.NAME}}` key material.
- **[human decision] 2026-08-09 — Upstream response bodies are NEVER echoed to
  callers (issue #13).** bifrost/core puts an unparsable non-2xx body verbatim
  into `Error.Message` (`core@v1.7.3 providers/utils/utils.go`, prefix
  `"provider API error: "`), and the gateway copied it into the client-visible
  envelope — turning a blind SSRF into a full read of anything the pod can
  reach. `sanitiseUpstreamMessage` (internal/llmproxy/httpio.go) replaces that
  form with a status-only message and caps every other upstream message at 256
  bytes as a second line of defence. Messages bifrost PARSED out of a structured
  provider error (quota text, rate-limit detail) are preserved — those are the
  tenant's own useful diagnostics.
  Guarded by `TestOpenAIErrorBody_DoesNotEchoUpstreamBody`,
  `TestGetConfigForProvider_PrivateNetworkGatedOnAllowlist` and
  `TestGetKeysForProvider_EgressGuardBeforeVault`; all mutation-verified
  2026-08-09.
  **Residual, NOT fixed here:** with no allowlist configured, a tenant can still
  ship its own vault-resolved secret to an arbitrary PUBLIC host as a Bearer
  token (`api_base: https://attacker.example/v1`). Setting the allowlist closes
  it; making that mandatory would break every cloud-provider install and is a
  separate human call. The chart's opt-in `networkPolicy` is defence in depth,
  not the primary control — see values.yaml for why it cannot default to on.

## Shared/public project scope
- **[human decision] The public project id is OPERATOR CONFIGURATION
  (`ELITEA_AI_PROJECT_ID`), not a field on the signed identity.** Chosen
  2026-08-14 for issue #316, which allowed either shape and asked that the
  choice be recorded.

  *Context:* the gateway read `p_{caller}` only. Elitea has always had two
  sources of models for a project — its own rows, and the public project's
  `shared = true` rows. The UI pickers offer both (`include_shared`), so a user
  could select a platform model that the gateway then had no credential for. In
  the `ELITEA_ALLOW_PROJECT_OWN_LLMS=false` deployment mode that left no usable
  model at all.

  *Rationale for configuration over the identity header:*
  1. The value is a DEPLOYMENT-WIDE CONSTANT. elitea-main reads it from the
     environment too (`ELITEA_AI_PROJECT_ID`, default 1); it does not vary per
     request, per user or per tenant. Sending a constant per request only
     creates ways for it to be wrong.
  2. It selects a SECOND SCHEMA TO READ. A request-carried value would let
     anyone who can set headers name any project as "public" and read that
     project's rows — a cross-tenant read, and exactly the failure this issue
     warned against. Configuration removes that surface completely.
  3. Carrying it on the identity means changing the HMAC canonical string, which
     both modules must change in lockstep; a version skew either fails every
     request or, if the field is left unsigned, is forgeable. Changing the
     signing scheme is a trust-boundary change (see CLAUDE.md's autonomy
     boundary) and needs a human, which this issue did not ask for.

  *Accepted cost:* the id is set in two places and can drift. A gateway pointed
  at the wrong project serves a model set the UI does not offer. Mitigations:
  the chart documents that the value must match elitea-main's, and main() logs
  the resolved mode at startup — armed with the id, or an explicit warning that
  shared models are unreachable.

  *Default OFF (empty), not 1.* An id naming a schema that does not exist makes
  every credential read fail, so the operator opts in. An unset scope reproduces
  the previous project-local behaviour exactly.

- **Precedence: the caller's OWN row wins.** This matches the legacy resolver
  (`runtime_interface_litellm` `_map_model_name`), which probed
  `{project}_{model}` before `{public}_{model}`. Credentials from the caller's
  project are returned first; on a model-id collision the caller's row is kept
  and the shared row is dropped, so the id appears exactly once. Both rules are
  pinned by tests. NOTE the issue explicitly did NOT decide which credential
  should win where two rows share an id but carry different secrets — bifrost
  picks from the key list we return, and ordering is the only lever this change
  takes. Revisit if product wants shared credentials to override a project's own.

- **Two isolation invariants, and neither may be weakened without a human:**
  1. The public scope is read ONLY with `AND shared = true`. The predicate is a
     constant and is never built from caller-supplied input.
  2. Every row returned from the public scope is re-checked against its own
     `shared` column in Go before use, and the read FAILS if one escapes. This
     mirrors elitea-main's "escaped its authorized scope" check on the same
     table. It exists because the SQL predicate is the kind of thing a later
     refactor drops silently.

  A shared credential's `{{secret.NAME}}` reference resolves against the PUBLIC
  project's Fernet vault, not the caller's — the vault scope follows the
  credential's owner. Resolving against the caller would either fail or pick up
  an unrelated same-named secret of the caller's.

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

## Model-name mapping
- **The advertised model id and the provider model name are two different
  names, and the gateway maps one onto the other before dispatch (issue #317).**
  `GET /llm/v1/models` advertises `elitea_title`, a user-authored label. The
  provider only knows the row's `data.name`. The two are independent by
  construction, so the inference path sent the provider a name it does not know.
  LiteLLM did this mapping; nothing replaced it when LiteLLM was removed.

  `internal/llmproxy/modelmap.go` is the single resolution point. Every dialect
  calls `mapModel` after it decodes the request and BEFORE the budget gate. The
  order is load-bearing twice: the provider must never see an unmapped title,
  and the cost tables are keyed by the provider's model name.

- **The provider wire name stays inside the gateway.** `modelObject.providerModel`
  is unexported, so `encoding/json` cannot put it in a caller-facing response.
  Guarded by `TestModelMap_ListDoesNotLeakTheProviderWireName`.

- **The request accepts BOTH the advertised id and the row's own `data.name`.**
  Both name the same configuration row, so both map to the same dispatch. This
  is not a widening: a name that no configured row carries is still rejected.

  *Why both:* every caller that exists today sends `data.name`, not the title.
  elitea-main's model catalog exposes an `llm` row under `data->>'name'`
  (`internal/infra/db/repos/models.go`), the web model picker posts that string
  back as `llm_settings.model_name`, and the e2e seed gives the same row the
  title `e2e-mock-model-llm` and the name `E2E-MOCK-MODEL`. An id-only rule
  would 404 the whole chat path on the first request.

- **An id that matches nothing is 404 at the gateway** (`model_not_found`),
  not an opaque provider error. Guarded by
  `TestModelMap_UnknownModelIs404AndNeverReachesTheProvider`.

- **An UNREADABLE model set forwards the caller's model unchanged.** This is the
  degraded path only: no project on the request, no database, or a query failure
  with nothing cached. The gateway cannot prove the model is wrong, and a 404
  here would turn a database blip into a total inference outage. It is
  deliberately NOT the fail-closed rule the budget path uses — no money and no
  tenant boundary depend on this mapping, and a wrong name fails at the provider
  anyway. Do not change it to fail closed without a human.

  The resolver reports "read the set" and "could not read the set" as different
  answers (`ModelResolver.list`). `List` collapses both to an empty slice, which
  is correct for `/llm/v1/models` and WRONG for dispatch. Keep them distinct.

- **Which name SHOULD be the addressable one is still a product decision.**
  Issue #317 did not pick one, because it changes what external SDK users type.
  This change only makes the list and the request path agree.

- **The shared scope and the name mapping compose in one row loop (#316 + #317).**
  The scope decides WHICH rows come back. The mapping decides WHAT EACH ROW
  CARRIES. They are independent, so `queryScope` builds every row the same way
  in both scopes: a shared row carries `providerModel` exactly like an own row.

  A shared row that carries no provider model name sends the provider a
  user-authored title, and it prices the wrong model at the budget gate, because
  the cost tables are keyed by the provider's name. Both suites are blind to
  this on their own: the #316 tests assert model ids only, and the #317 tests
  seed one scope only.

  `shared_modelmap_test.go` pins the join. It asserts what the PROVIDER
  received, never the status. Three properties are guarded:
  - A shared model dispatches its `data.name`
    (`TestSharedModelDispatchesTheProviderWireName`).
  - On an id collision the CALLER's row supplies the dispatched name
    (`TestCollidingModelIDDispatchesTheOwnRowWireName`). The two rows share an
    id, so the dispatched name is the only evidence of which row won.
  - An unpublished row dispatches under NEITHER of its two names
    (`TestUnpublishedModelIsNotDispatchable`). #317 accepts `data.name` as an
    alias, so the wire name is a second way in if the predicate ever fails.

- **The model set is EVERY addressable configuration section, not the `llm`
  section.** `addressableModelSections` (`internal/llmproxy/models.go`) lists the
  `(section, type)` pairs the resolver reads: `llm`/`llm_model`,
  `embedding`/`embedding_model`, and
  `image_generation`/`image_generation_model`.

  *Why this is a correctness rule and not a preference:* `mapModel` gates EVERY
  dialect against this one set. While the resolver read `llm` rows alone, a
  project's `embedding`/`embedding_model` row was invisible to it, so
  `POST /llm/v1/embeddings` answered 404 `model_not_found` for a model the
  project had configured and whose credential resolved. Measured on the
  standalone stack: the index plane's embedding hop could not dispatch at all.
  `/llm/v1/images/*` had the identical defect. The `llm`-only read predates
  `mapModel` — it was written for `GET /llm/v1/models`, where it was harmless,
  and #317 turned it into a gate without widening it.

- **The fix is in the gateway, NOT in the seed.** Seeding an embedding model as
  an extra `llm`/`llm_model` row also makes it resolve, and it is a smaller
  change. It is rejected because those rows ARE the chat catalogue: elitea-main's
  `/configurations/models/{projectId}` selects `section = 'llm'`
  (`CurrentModelSectionLLM`), which is what the web chat model picker reads. An
  embedding model would become a selectable chat model in the product, for every
  project seeded that way. Keep each model in its own section and make the
  gateway read them all.

- **`asr` and `tts` joined the list with the audio routes (issue #323).** They
  were absent while the gateway mounted no audio route, because admitting a
  section with no route advertises a model no caller can reach. `vectorstorage`
  holds no model and stays out. Add a pair to `addressableModelSections` when,
  and only when, you add a route that dispatches it — `model_sections_test.go`
  covers each pair on its own route.

- **[2026-08-20, issue #323] The gateway serves `/llm/v1/audio/speech`,
  `/audio/transcriptions` and `/audio/translations`.** *Finding:* the retired
  LiteLLM proxy served the first two, and `pylon-indexer`'s voice paths call
  them by absolute URL (`indexer_tts.py`, `indexer_asr_whisper.py`). Nothing
  replaced them, so that image kept a LiteLLM process of its own to answer them
  — a SECOND LLM data plane that applies no budget, bills nothing, and resolves
  credentials from a registry (`runtime_interface_litellm`, in the deleted
  pylon_main) that the platform no longer writes. The model registry it reads is
  therefore empty, so those calls already fail. *Decision:* implement the two
  routes here, on the same order every /llm route follows — decode, `mapModel`,
  `checkBudget`, dispatch, `updateUsage` — so the audio path is governed like
  every other. Two limits are deliberate and are stated in `audio.go`:

  | Limit | Why |
  |---|---|
  | Neither route streams | A streaming speech route needs the detached-drain billing machinery the chat stream has. The pylon TTS client reads the body with `iter_content`, so a unary body still arrives chunked to it; it loses first-byte latency, not audio. |
  | A response the catalog carries no rate for bills zero | `cost.Calculator` now prices three bases — tokens, seconds and characters (migration 0086) — but only from the catalog. There is no default per-second or per-character price and there must not be one: an invented rate reaches the authoritative budget counter as if it were measured. A model with no catalog audio rate is UNPRICED. The condition is counted on `gateway_audio_unpriced_total` and logged, not hidden. |

  **Two follow-up decisions, both from the adversarial review of this change:**

  | Question | Decision |
  |---|---|
  | The widened price `SELECT` names four columns migration 0086 adds. What happens on a pod that rolls out ahead of `elitea-migrate`? | Postgres answers 42703 for EVERY model, and `lookupCatalog` reads any non-`ErrNoRows` error as "uncatalogued" — so the WHOLE catalog would silently bill at the default price table for the length of the skew. `queryCatalog` now catches 42703 alone, latches, and re-reads the same row with the pre-0086 two-column statement. Token pricing survives; only the audio rates go missing, so audio is UNPRICED and counted. The latch expires after 5 minutes and lifts itself when the migration lands. `gateway_price_catalog_schema_behind` (gauge) and `..._total` (counter) are the signal: one for the process, not one log line per model per cache TTL. |
  | The speech route bills a character count bifrost computed from OUR request (`BackfillParams`), not one a provider reported. Is that legitimate? | Yes, and `audio.go` says so plainly. A character-billed TTS provider charges for the input text it was sent, so a rune count of that exact text IS the billable quantity, not an estimate of one. Contrast `BifrostTranscriptionResponse.Duration`, which bifrost DERIVES from word timestamps: that is an observation of something the provider never stated, and `transcriptionUnits` still refuses it. The rule is "bill the quantity the sale is priced on, never an inference about it". Because bifrost backfills that count on every speech response and refuses an empty input, the speech "no usable usage" branch is unreachable through the real router; it is marked as a guard for a non-bifrost router, and the test for that shape now runs against the transcription route, where it is real. |

  **Realtime ASR is NOT covered.** `indexer_asr_realtime.py` opens a WebSocket
  to `/v1/realtime`. bifrost/core carries a realtime surface, but a WebSocket
  route needs its own budget and billing design, and no SDK caller uses it.

- **The declared order is the precedence order.** `modelsSQL` joins the pairs
  with `WITH ORDINALITY` and orders by the ordinality before the row id, so a
  model id two sections both carry resolves to the earlier section, and `llm`
  first keeps the chat models in the positions they held before the set grew.
  The pairs travel as bind parameters: no part of the statement text is built
  from the section list.

- **Advertising the other sections on `GET /llm/v1/models` is intended.** OpenAI's
  own `/v1/models` lists embedding and image models, the legacy LiteLLM list did
  too (`preflight.StaticLegacyModels` carries `text-embedding-3-*`, and the BFF.3
  parity gate asserts they stay present), and the web pickers do not read this
  route. It also keeps the invariant `modelmap.go` states: list and dispatch
  agree.

- **[human decision] 2026-08-17 (issue #469) — an unreadable model set REFUSES
  the request. It does not forward the caller's model unmapped.** *Finding:* the
  three conditions in which the resolver cannot read a project's model set all
  produced one outcome: HTTP 200, with the caller's model name sent to the
  provider with no map. The deleted elitea-main handler refused the same
  condition with 502. Pull request #285 reversed that direction and recorded no
  reason. *Decision, per condition:*

  | Condition | Behaviour | Why |
  |---|---|---|
  | Empty project identifier | 404 `model_not_found` | A condition of the request, not a fault. A caller with no project has no configured model and no credential: `GetKeysForProvider` returns zero keys for an empty project. The budget gate also skips a request with no project, so an accepted request would be unmapped AND unmetered. |
  | Nil database handle | 502 `model_catalogue_unavailable` | A wiring fault. `main.go` gives a gateway with no pool NO resolver, and that posture forwards every model unchanged. A resolver that exists with no database can never map anything, so forwarding would make the degraded path permanent. |
  | Query failure, nothing cached | 502 `model_catalogue_unavailable` | A database fault, and the gateway has never read this project's list. |

  *Why no new permissive path is bounded and kept:* the bounded permissive path
  already exists one layer down. A query failure WITH a cached list serves the
  last good list and reports the set as known, so the request maps and dispatches
  as normal (`models.go`, `List`). That list is bounded because every name in it
  came from a real configuration row. The three conditions above are exactly the
  ones in which no list exists, so "permit only a cached name" would permit
  nothing. `TestModelMap_QueryFailureWithACachedListStillDispatches` pins the
  stale path; delete it and a database blip becomes a total outage.

  *Accepted cost:* a project whose model set has never been read gets 502 for
  every request during a database outage, instead of a provider error. The
  counters below make that state visible.

- **A refusal an operator cannot count is a refusal nobody sees.** Each condition
  above increments its own `expvar` counter
  (`gateway_model_map_refused_no_project_total`, `..._no_database_total`,
  `..._lookup_failed_total`). `llmproxy.ModelMapMetricNames` is the ONE named
  path by which they reach `GET /metrics`, so the package that publishes a
  counter also states its name. No name is copied into a second file.

## Observability
- **[human decision] 2026-08-17 (issue #465) — `GET /metrics` serves a named
  allowlist. `/debug/vars` stays unpublished.** *Finding:* the
  `gateway_budget_enforcement_enabled` gauge had no route for its whole life.
  `expvar` registers `/debug/vars` on `http.DefaultServeMux`, and this process
  serves its own multiplexer. The comment said operators could alarm on the
  value 0, and no operator could read the value at all. This mattered most for
  issue #304: a gateway that starts while NATS is unreachable enforces nothing
  for the life of the process, and this gauge is the control that reports it.

  *Decision:* mount `/metrics` on the gateway multiplexer, in the Prometheus
  text exposition format, serving the variables `gatewayMetrics` names and
  nothing else. `expvar.Handler()` is NOT used: it writes every variable the
  process publishes, `cmdline` (the process arguments) and `memstats` included,
  on the same listener that serves `/llm`. The wiring gate in `main_test.go`
  forbids the call, and requires the `mux.Handle("/metrics"` mount.

  *Exposure:* the shipped Service is ClusterIP with mutual TLS, and the edge
  proxies only the `/llm` paths, so `/metrics` is reachable from inside the
  cluster and not from a tenant.

  *Proof rule for this route:* a test that reads the variable in the same
  process does not prove a route exists. `TestMetricsRoute_IsServedByTheRunningGateway`
  builds the binary, starts it, and scrapes it over HTTP. Remove the mount and
  that test answers 404, while every handler-level test still passes.

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
- ~~Set `secrets.*.optional: false` ... for `GATEWAY_IDENTITY_SECRET`~~ — DONE
  2026-08-09 (issue #11, see the Trust-boundary entry above): it is `false` in
  the base chart for both the gateway and elitea-main. `SECRETS_MASTER_KEY`
  remains `optional: true` (unset ⇒ Fernet vault degraded single-level mode);
  making that one mandatory is still open and needs a human.
- elitea-main env-drift is still WARN-heavy for vars read via a default
  (`ELITEA_RUNTIME_ENABLED`, `REDIS_URL`, and ~19 others) with no chart
  override knob at all — real, now-visible (the two bugs above previously
  hid most of it), and left as accepted debt: wiring 20+ unrelated knobs
  into values.yaml was out of scope for the storage-migration work that
  surfaced this. WARN does not fail CI.
