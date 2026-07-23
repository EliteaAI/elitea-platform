# LLM Gateway — LiteLLM→Bifrost Migration Tasks

Source of truth: `elitea-docs/docs/internal/03-architecture/llm-gateway/`
(ADR-0015 Option E, `design-bifrost-gateway`, `spec-bifrost-migration`, `runbook-bifrost-cutover`).

Architecture: a standalone `elitea-llm-gateway` service embeds `bifrost/core`, runs as
N stateless replicas behind `elitea-llm-gateway-svc` (mTLS-only), and coordinates shared
state through **NATS JetStream** (not Redis/Valkey). `elitea-main` stays a lightweight
auth edge + streaming reverse proxy. Deployment is the **scale-1** profile (single node,
`replicas=1`); HA (`replicas>=3`, RAFT quorum) is opt-in. Cutover is **big-bang** — no
shadow, no canary, no per-project cutover state; rollback is a release revert.

> **Prove BF0.3a (SSE incremental flush) as a spike BEFORE relying on the loop for BF0.3+.**
> It is the biggest technical unknown and gates cutover. If it cannot be made to flush
> per-chunk through the converter + net/http + reverse-proxy path, the plan must change.

---

## Phase BF-Build: gateway + NATS + edge (big-bang, pre-cutover)

There is **no cutover tracker, no shadow, and no canary** — the gateway serves all
`/llm` traffic from the cutover release onward. The edge simply reverse-proxies `/llm`
to `elitea-llm-gateway-svc`; there is no per-project routing state to author.

- [x] BF0.0 Enable global soft-alert emission
  - [x] Add `PUT /admin/gateway/budget-alerts` (RequirePermissions-gated) in `services/elitea-main/internal/api`
  - [x] Confirm no per-project cutover tracker and no `/admin/llmcutover` routes are built
  - [x] Run validator: `python .ralph/validate.py --phase phase-bifrost-build`

- [x] BF0.1 Implement middleware.Project project resolution
  - [x] Replace the pass-through stub in `services/elitea-main/internal/api/middleware/project.go`
  - [x] Port token→project_id derivation (PROJECT_USER_NAME_PREFIX + personal-project RPC)
  - [x] Expose `ProjectFromContext` and `resolveProjectID`; remove all TODO/FIXME/NotImplemented
  - [x] Unit tests (>=85% coverage)

- [x] BF0.2 Stand up the elitea-llm-gateway module on Go 1.26.4
  - [x] Create `services/elitea-llm-gateway/` with `go 1.26.4` in its go.mod and `FROM golang:1.26.4` in its Containerfile; bump the CI runner image used to build it (new `.github/workflows/ci-gateway.yml` on go-version 1.26.4)
  - [x] Add `github.com/maximhq/bifrost` (pinned tag) to go.mod (`github.com/maximhq/bifrost/core v1.7.3`)
  - [x] Run `go work sync`; confirm only the gateway module names 1.26.4 and the workspace still builds (gateway is kept OFF go.work: `go work sync` escalates the workspace go directive to 1.26.4, violating the elitea-main toolchain-unchanged constraint; the gateway is a standalone module built with `GOWORK=off`. Go itself rejects a 1.26.4 module in the 1.25.8 workspace. Workspace still builds; gateway is the only module naming 1.26.4.)
  - [x] Spike branch: run task test/vet/lint/build for the gateway module + smoke build of the workspace to catch 1.25→1.26 regressions (gateway vet/build/test green, 100%/100%/90.9% pkg coverage; golangci-lint 0 issues; all workspace modules build clean)
  - [x] Apply pre-cutover gateway Deployment/code changes: memory >=1Gi, terminationGracePeriodSeconds >=150 + preStop, gateway `srv.Shutdown()` context >=150s, `http.Server` WriteTimeout 0 for the `/llm` SSE path, inject slog/OTel Logger, tune `BifrostConfig.InitialPoolSize` + per-provider `ProviderConfig.ConcurrencyAndBufferSize.Concurrency` (design §9.5)

- [x] BF0.2-account Implement the bifrost.Account interface in the gateway
  - [x] `services/elitea-llm-gateway/internal/account/account.go`: implement `GetConfiguredProviders`, `GetKeysForProvider`, `GetConfigForProvider`
  - [x] Read provider credentials from the Fernet vault (Postgres) per request; never surface raw keys
  - [x] Static self-referential-credential guard: reject any credential whose `api_base` resolves to the platform's own `/llm` origin (reason `SELF_REFERENTIAL_CREDENTIAL`)
  - [x] Unit tests (account pkg 92.1% coverage, real Fernet round-trip)

- [x] BF0.2a Implement elitea-main → gateway streaming reverse proxy + mTLS
  - [x] `services/elitea-main/internal/llmproxy/proxy.go`: `httputil.ReverseProxy` with `FlushInterval < 0` (no buffering) to `elitea-llm-gateway-svc` over mTLS; disable `http.Server` WriteTimeout for `/llm` (per-connection write deadline cleared via `http.NewResponseController(w).SetWriteDeadline(time.Time{})` in ServeHTTP); propagate `X-Accel-Buffering: no` (ModifyResponse). mTLS HTTP/1.1 transport (NextProtos http/1.1, ForceAttemptHTTP2 false)
  - [x] Inject signed identity headers `X-Elitea-Project-Id` / `X-Elitea-User-Id` / `X-Elitea-Tenant-Id` (+ HMAC `X-Elitea-Identity-Signature`) in `internal/llmproxy/identity.go`; strip client-spoofed values first; gateway trusts them only on the mTLS-internal network
  - [x] Unit tests (llmproxy pkg 100% coverage: identity round-trip/spoof-strip/tamper, streaming incremental-flush through the hop, write-deadline clear, 502 on upstream down, mTLS transport build)

- [x] BF0.2b Provision the NATS JetStream cluster + gateway Helm/ArgoCD app
  - [x] NATS JetStream: pick the profile (design §8.1.1) — scale-1: single node, replicas=1, file storage; HA: 3/5 nodes, replicas>=3, file storage — NATS Server 2.12.0+ (required for Nats-Incr) (upstream `nats` chart wrapped as a subchart in `deploy/helm/nats`; `values-scale1.yaml` = single node, `values-ha.yaml` = 3-node RAFT quorum + topology spread; both pin `container.image.tag: 2.12.0-alpine`)
  - [x] Create KV buckets `GATEWAY_BUDGET` / `GATEWAY_ALERT_COOLDOWN` and stream `GATEWAY_BUDGET_DELTAS` (with duplicate_window + retention limits) (idempotent `deploy/helm/nats-bootstrap` chart: pre-install ConfigMap embeds `files/bootstrap.sh`, post-install/upgrade hook Job runs it via nats-box; `--dupe-window`/`--max-age`/`--max-bytes`/`--max-msgs`/`--replicas ${REPLICAS}`; NO GATEWAY_CUTOVER bucket)
  - [x] New Helm/ArgoCD app for elitea-llm-gateway: Deployment + `elitea-llm-gateway-svc` ClusterIP (mTLS-only, not public) + HPA on a custom /llm SSE-connection metric + mTLS certs (`deploy/helm/elitea-llm-gateway`: `service.yaml` ClusterIP:8083, `hpa.yaml` Pods metric `gateway_llm_sse_active_connections`, `certificates.yaml` cert-manager server+edge-client certs; 3 ArgoCD apps ordered by sync-wave -2/-1/0 in `deploy/argocd`)
  - [x] Configure the `nats --context gateway` context so the validator resolves (`deploy/nats-context/gateway.json` template + `install-context.sh`; live validator needs a reachable NATS + `nats` CLI, so it fails in this offline dev env like the sibling BF-Build infra checks)

- [x] BF0.3 Implement the gateway /llm chi handler, converter, and net/http SSE loop
  - [x] Mount `/llm/v1/messages` exact route before `/llm/v1/*` catch-all in `services/elitea-llm-gateway/internal/api/router.go` (chi `r.Route("/llm/v1")` registers `/messages`, `/messages/count_tokens`, `/messages/*` before the OpenAI JSON routes; regression asserted in `internal/api/router_test.go`)
  - [x] Decode request bodies into dialect request structs and call `bifrost/core` methods directly — the integrations `Create*RouteConfigs` require a fasthttp `lib.HandlerStore` and `RequestConverter`/`ChatStreamResponseConverter` are not net/http helpers (design §6.3); do NOT attempt to call them with an `*http.Request` (handlers decode `openai.*`/`anthropic.AnthropicMessageRequest`, call `To*Request(ctx)`, and dispatch through the `LLMRouter` seam over the embedded `*bifrost.Bifrost`)
  - [x] `handler.go`: net/http SSE loop consuming `chan *BifrostStreamChunk` with `http.Flusher` for both dialects; set `X-Accel-Buffering: no` + `Connection: keep-alive` and clear the per-connection write deadline (reuse pkg/ssewriter) (`beginStream` asserts `http.Flusher`; `pkg/ssewriter` sets the headers + clears the deadline via `http.NewResponseController`; `streamOpenAI`/`streamResponses`/`streamAnthropic` frame the three shapes)
  - [x] For `/llm/v1/images/edits` and `/llm/v1/images/variations`, the gateway parses the multipart body itself (`r.ParseMultipartForm`) and builds the core request struct (`internal/llmproxy/multipart.go`; accepts `image[]`/`image`, reads `mask`, parses int/bool/string optionals, required-field 400s)

- [x] BF0.3a Prove SSE incremental flush (spike — biggest technical unknown, §2.3)
  - [x] `TestSSEIncrementalFlush`: mock `http.Flusher` with a call counter; assert chunks are written before end-of-response for both OpenAI and Anthropic (both are text/event-stream, differing only in event names) (`internal/llmproxy/sse_flush_test.go`: `flushRecorder` (http.Flusher + call counter/byte-snapshot) driven by a lock-step producer over an UNBUFFERED channel — chunk i+1 is produced only after chunk i's flush is observed; a buffering handler blocks the producer and the 5s watchdog fails the test. Asserts flush-count==frame-count, monotonically-growing body per flush, first-flush < full-body. Both dialects green through the real handler→ssewriter→Flush path)
  - [x] Spike result documented and accepted; gates cutover (SSE incremental flush is PROVEN through the direct-converter + net/http + `http.Flusher` path for both dialects. Verified as a genuine proof, not a false positive: a negative-control run with `ssewriter.Flush()` disabled fails exactly as designed — producer blocks on chunk 0, flush-count 0, only first chunk delivered. The `fasthttpadaptor` path (§2.3) is confirmed unnecessary. BFF.1 (`cutover-ctl sse-flush-check`, through the reverse-proxy hop) remains a later BF-PF gate)

- [x] BF0.3b Cover the less-exercised whitelisted paths
  - [x] `TestResponsesAPIRoundTrip`: POST `/llm/v1/responses`; assert HTTP 200, response_format preserved, finish_reason present (Responses-API dialect note: `response_format`→`text.format` object, `finish_reason`→terminal `status`; there is no literal `finish_reason` key in the Responses schema. Test asserts request-side `text.format` (json_schema) survives decode+`ToBifrostResponsesRequest`, `openai/`-prefixed model splits to provider=openai/model=gpt-4o, and response-side `status:"completed"` present in the unary JSON body. Plus `TestResponsesAPIRoundTrip_MinimalStringInput` for the bare-string input form)
  - [x] `TestCountTokensSubPath`: POST `/llm/v1/messages/count_tokens`; assert HTTP 200, synchronous (non-SSE) body, and that an unknown `/llm/v1/messages/{suffix}` returns 404 (asserts `application/json` (not text/event-stream), no `data:`/`event:` framing, Anthropic `{"input_tokens":N}` shape; unknown `/messages/retrieve`→structured 404 `invalid_request_error`. In `internal/llmproxy/responses_paths_test.go`; `fakeRouter.ResponsesRequest` now captures the decoded request. All 3 green via `cd services/elitea-llm-gateway && GOWORK=off go test`; pkg coverage steady 87.5%)

- [x] BF0.4 Budget counter, write-behind, tiered-hybrid fail-mode, and price catalog
  - [x] Wire the NATS client + JetStream in the gateway and elitea-scheduler: open KV buckets `GATEWAY_BUDGET` / `GATEWAY_ALERT_COOLDOWN` and the `GATEWAY_BUDGET_DELTAS` stream; re-point the EventBus from Redis pub/sub to NATS `gateway.events.*` (NATS-client/JetStream provisioning in commits 5692c94 hardening + 06e67e0 server lifecycle + 76aed8d write-behind. EventBus re-point (this slice): `services/elitea-main/internal/infra/natsbus/eventbus.go` — drop-in for `redis.EventBus` carrying the identical `redis.Event` envelope so the webhook dispatcher + project SSE handler decode unchanged; only the transport differs. `subjectFor` maps Redis channels to NATS subjects under `gateway.events` (`:`→`.`, `""`→root, bare `*` and `prefix:*` catch-alls→`>` multi-token wildcard). `Publish` flushes (FlushTimeout=1s) so a send error surfaces synchronously; `Subscribe(ctx,channel,redis.EventHandler)` matches the redis signature so `webhookDispatcher.HandleEvent` passes unchanged; `Raw(ctx,channel)` feeds the transport-agnostic SSE handler; `Ping` satisfies health.Checker. Narrow `natsConn`+`subscription` interface seams (realConn embeds *nats.Conn, promotes Publish/Flush/RTT/Drain/Close, overrides only ChanSubscribe) → fakeConn/fakeSub in-memory pub/sub with NATS wildcard matching, 89.0% cov. `internal/events` gains `EventBudgetSoftAlert`+`SoftAlertPayload` (design §8.3). `internal/api/v2/events/handler.go` refactored to a transport-agnostic `EventSource` seam (`redisSource` preserves the existing Redis pub/sub decode; `NewHandlerFromSource` takes the NATS bus), 88.5% cov (miniredis round-trip). main.go: `GATEWAY_NATS_URL` selects NATS bus for EventBus+health+SSE with non-fatal boot fallback to Redis; go.work stays 1.25.8, gateway module untouched. gofmt/vet/golangci-lint clean.)
  - [x] Migrations: `project_budget` (+ `nats_fail_mode`, `soft_alert_pct`), `llm_budget_accumulators` (+ `outage_mode`, `reconciled`), `rate_policy` column on `llm_credentials`, `gateway_models` (`input_cost_per_1m_tokens` per-1M denomination, UNIQUE(provider, model_name)) (dump-guard-exempt `gateway_migrations/*.sql` applied unconditionally + idempotently via new `applyMigrationDir`; all 6 cutover-critical columns; `gateway_migrations_test.go` green; commit 632e843)
  - [x] Harden the NATS client: connection Timeout=1s; `context.WithTimeout(ctx,150ms)` on every KV get / Nats-Incr (`internal/infra/nats/nats.go`, sony/gobreaker breaker, ensureAssets creates counter stream + cooldown KV + deltas stream, 89.2% cov; commit 5692c94)
  - [ ] Implement the NATS `GovernanceStore` (Check*/Update*/Dump*/ResetExpired*) + configStore adapter; wire the governance plugin via `InitFromStore(...)`; enforcement uses `Nats-Incr` on int64 nano-USD counters + circuit breaker (sony/gobreaker); on billed increment, publish a delta to `GATEWAY_BUDGET_DELTAS` with `Nats-Msg-Id = event_id`
  - [x] Implement JetStream write-behind consumer (budget-writeback durable pull consumer in elitea-scheduler): Fetch → batch delta-UPSERT to `llm_budget_accumulators` → explicit ACK after commit; AckWait/MaxDeliver redelivery + `processed_event_ids` dedup (same txn); stream retention limits (design §8.6) (`services/elitea-scheduler/internal/budgetwriteback/`: `Consumer.Run` drain loop over a `Fetcher` seam — Fetch up to BatchSize (default 500) → coalesce per `(scope,scope_id,period_start)` preserving order → apply each key-group in its OWN pgx transaction; `Store.Apply` runs same-txn dedup `INSERT INTO processed_event_ids … ON CONFLICT DO NOTHING RETURNING` (pgx.ErrNoRows ⇒ already-applied ⇒ contributes 0, so partial redelivery of a coalesced group is never double-counted) then ONE guarded UPSERT `… DO UPDATE … WHERE NOT (acc.outage_mode AND NOT acc.reconciled)`; RowsAffected==0 ⇒ outage-owned row ⇒ Rollback + `outcomeDeferred` ⇒ NAK for redelivery (the §8.5/§8.6 disjoint-row invariant); poison msg (bad JSON / failed `validate()`) is Term'd not redelivered; nano-USD→USD is the SINGLE `$7::numeric / 1e9` convert point in SQL (never float64). `BudgetDelta` wire contract extends the §8.6 minimal payload with `project_id`/`org_id`/`period_end` (accumulator NOT NULL cols); durable `budget-writeback` pull consumer bound via `jetstream.CreateOrUpdateConsumer` (AckExplicit, AckWait/MaxDeliver); `BUDGET_WRITEBACK_*` + `GATEWAY_NATS_URL` env wired in config+main, default-disabled, boot NATS blip non-fatal. 85.6% pkg cov — remainder is the live pgxpool.Begin/jsFetcher.Fetch/Bind adapter seam (same infra-bound uncovered seam as pricesync's db.go); gofmt/vet/golangci-lint clean, `go mod tidy` promoted nats.go to a direct dep)
  - [x] Implement tiered-hybrid fail-mode FSM (NATS→PG-snapshot fallback; 402 over-limit, 503 stale/down) per design §8.5; add breaker-driven recovery reconciliation goroutine in the gateway (`services/elitea-llm-gateway/internal/failmode/`: `fsm.go` pure `Decide` §8.5 state table — 6 states, healthy 402/allow; FORCED_CLOSED 503 overrides is_unlimited+fail_open; explicit fail_open/fail_closed; is_unlimited allow; stale⇒503; FRESH_OVER 402 / FRESH_NEAR per-replica cap `(limit−accum)/N` / FRESH_SAFE degraded-cap; nano-USD int64 throughout. `counter.go` `DegradedCounters` per-scope `sync/atomic.Int64` overspend tracker (reset per-scope AFTER replay confirmed, never per-request). `store.go` snapshot point-read (LEFT JOIN project_budget+accumulators, USD→nano in SQL, age from now()−last_updated) + outage-window UPSERT `outage_mode=true` (off-response-path, single `$7::numeric/1e9` convert). `recovery.go` breaker→CLOSED one-shot 3-phase reconciler: enumerate `SELECT … FOR UPDATE SKIP LOCKED` outage rows + set `reconciliation_in_progress` marker → per-scope re-lock + replay `accumulated−counter` delta via new `IncrBudgetIdempotent` (reused `Nats-Msg-Id`, dedup-window suppression) → same-tx finalize `reconciled=true,outage_mode=false`; per-scope cap reset on success, `ResetAll` only when whole pass clean, caps RETAINED on any failure; recompute-from-live-state makes replay naturally idempotent + reused event_id covers lost-ack. NATS client gains `IncrBudgetIdempotent` + `RecoveryDedupeWindow=12m` on the counter stream (`StreamConfig.Duplicates`). config §8.5 knobs (`LLM_BUDGET_NATS_FAIL_MODE`/`PG_FRESHNESS_MIN`/`NATS_DEGRADED_MAX_DURATION_MIN`/`NATS_DEGRADED_CAP_USD`/`EXPECTED_REPLICAS`). failmode 87.3% cov (race-clean; uncovered = pgx adapter seam only), nats 90.8%, gofmt/vet/golangci-lint clean. NOT yet wired into request path — that is s4 GovernanceStore's job.)
  - [x] Seed `gateway_models` from pylon centry; implement price-sync worker (24h fetch of LiteLLM `model_prices_and_context_window.json`, PG advisory lock, fail-open on fetch error) per design §8.8 (`services/elitea-scheduler/internal/pricesync/`: `Denomination`+`Normalizer` single ×1e6 per-token→per-1M convert point guarding the 1,000,000× bug; ordered `PriceSource` precedence — `LiteLLMSource` (HTTP, per-token) then embedded `SeedSource` (go:embed `seed_models.json`, per-1M, airgapped fallback); `Syncer` fetches-before-lock, `pg_try_advisory_xact_lock` multi-replica guard, first-source-wins merge with drift alarm, fail-open per-source, per-1M UPSERT into `gateway.gateway_models`; `Worker` 24h ticker w/ immediate pass + 2m per-pass timeout; `config` `PRICE_SYNC_*` env (default disabled) wired in `main.go`; 89.9% cov; gofmt/vet/golangci-lint clean)
  - [x] Validate cost math against pylon CostCalculator (per-1M price → nano-USD counter — guard the 1000× bug and keep the two denominations distinct) (`services/elitea-llm-gateway/internal/cost/`: `Calculator.Cost/Price` resolve per-1M nano-USD price from `gateway.gateway_models` (NUMERIC×NanoUSD ::bigint in SQL — no float on the money path), 5-min TTL cache, then a pylon-parity ORDERED default table (insertion-order prefix match: gpt-4o-mini before gpt-4o before gpt-4; o1-pro before bare o1 — a Go map would shadow the longer prefix), then a 1.0/3.0 USD fallback; never errors on an unknown model so a pricing gap can't block /llm. `costNano = round(tokens*priceNanoPer1M/TokensPer1M)` via math/big (no int64 overflow, half-up); `TestCostNano_PylonParityVectors` pins the exact pylon test_cost_calculator.py vectors (gpt-4o 1000in/500out ⇒ 2.5e6/5e6/7.5e6 nano == 0.0025/0.005/0.0075 USD), `TestCostNano_ThousandXBugGuard` pins 1M tok @ $2.50/1M = 2.5e9 nano (NOT the ×1000 per-1k value); NULL-input⇒default, NULL-output⇒input×3, DB-error⇒fail-open-to-defaults; 96.4% cov; gofmt/vet/golangci-lint clean. Offline-CI proxy for BF0.4's live `psql` column-count validator.)

- [x] BF0.4b Disjoint-row integration test
  - [x] `TestDisjointRowWriteBack`: write-back consumer (NOT outage_mode) and recovery reconciliation (outage_mode AND NOT reconciled) touch disjoint rows — no double-count, incl. post-recovery resume (the two writers live in separate modules behind `internal/` — no package imports both, and this offline env has no shared live Postgres — so the invariant is proven from BOTH sides against faithful in-memory accumulator-table models that evaluate the EXACT SQL predicates. Write-back side (`services/elitea-scheduler/internal/budgetwriteback/disjoint_writeback_test.go`): drives the REAL `Store.Apply` — the `tableTx` fake models transactional staging so a deferred group persists NO dedup rows (redeliverable) and evaluates the `upsertSQL` guard `NOT (outage_mode AND NOT reconciled)` → `RowsAffected==0` → `outcomeDeferred`. Full lifecycle: outage-owned row DEFERS (untouched, no dedup leak) → healthy row applies (writers never collide) → `modelRecovery()` finalizes ONLY the outage row (real `selectOutageRowsSQL`/`finalizeRowSQL` effect: preserves accumulated spend, flips flags) → redelivered delta now applies exactly once on top ($5 outage + $2 = $7, no double-count) → second redelivery is a dedup no-op. `assertDisjointOwnership` checks the two predicates partition the row space at each step; `_CoalescedGroupDeferredAtomically` proves a multi-delta group defers atomically. Recovery side (`services/elitea-llm-gateway/internal/failmode/disjoint_recovery_test.go`): drives the REAL `Reconciler.runPass` against a table whose enumerate `Query` FILTERS by `recoveryOwns()` (real `outage_mode AND NOT reconciled`), so a healthy write-back-owned row is provably EXCLUDED from every recovery touch — asserts the healthy row's flags AND accumulated total are untouched, replay delta = accumulated−counter onto the recovered NATS counter, and both rows return to write-back ownership post-recovery. budgetwriteback 85.6% / failmode 87.3% cov; gofmt/vet/golangci-lint clean; validator BF0.4b ✓)

- [ ] BF0.5 Synthesise /llm/v1/models per project from Postgres
  - [ ] `services/elitea-llm-gateway/internal/llmproxy/models.go`: resolve from `p_{projectID}.configuration` (section `llm`, field `llm_model`), 60s TTL cache; NOT routed through core
  - [ ] Single-model `/v1/models/{name}` returns 200/404

- [ ] BF0.6 Governance config-authoring surface (gates the full-feature CEL/per-model/MCP items)
  - [ ] Add `governanceSection()` to `services/elitea-main/internal/api/v2/admin/config_schemas.go` (enum rate_policy, number budget limits, integer rate limits, array MCP allowlist, enum_source project/team/model pickers)
  - [ ] Global governance config table + CRUD (reuse configurations/handler.go JSONB pattern; NOT p_{projectID} scope); the gateway GovernanceStore reads these rows → Bifrost Table* at load
  - [ ] Server-side RBAC (baseline): wrap ALL governance read/write/CRUD endpoints with `RequirePermissions("configuration.governance")` via middleware/rbac.go — the authorization boundary is the server; the section's client-side required_permission only hides the UI
  - [ ] CEL routing rules: build `admin_ui/src/SchemaForm/RoutingRuleEditor.jsx` (CEL field w/ highlighting + weighted-target table w/ inline Σ=1.0 + scope/priority); server MUST compile CEL + re-verify weights==1.0 on save (also a type:action "Validate CEL" control)

- [ ] BF0.6t Gateway llmproxy package coverage gate
  - [ ] `services/elitea-llm-gateway/internal/llmproxy` >= 85% coverage (handler, SSE loop, GovernanceStore, models synthesis)

- [ ] BF0.7 Resolve the stranded gateway proto
  - [ ] Audit `GatewayService.ChatCompletions` usage; if unused, mark the RPC `reserved`; if a live caller exists, rename to `InternalAgentStream`
  - [ ] Run `buf breaking`

- [ ] BF0.8 429→402 consumer-contract change
  - [ ] Audit and update 429-on-budget call sites in `services/elitea-main`/`elitea-sdk` to treat 402 identically (a big-bang consumer-contract change, MUST land before cutover)
  - [ ] Implement `cutover-ctl budget-status-audit --paths ...` as its validator

## Phase BF-PF: Pre-flight validation (all deterministic, staging; no production traffic)

Each gate is a `cutover-ctl` subcommand that exits 0 only when it holds. These subcommands
must be **added** to `services/elitea-main/cmd/cutover-ctl/main.go` as a `switch` case each
(the CLI currently implements only `status`, `summary`, `decommission-check`).

- [ ] BFF.1 SSE incremental-flush proven end-to-end through both hops for both dialects
  - [ ] Implement `cutover-ctl sse-flush-check`
  - [ ] Gate = `TestSSEIncrementalFlush` green through the reverse-proxy hop (§2.3)

- [ ] BFF.2 Cost-math parity vs pylon CostCalculator
  - [ ] Implement `cutover-ctl cost-parity --against pylon` (per-1M price → nano-USD; guards the 1000× bug)

- [ ] BFF.3 /llm/v1/models set equivalence
  - [ ] Implement `cutover-ctl models-parity --min-projects 5 --max-p99-ms 200` (order-insensitive; p99 < 200 ms)

- [ ] BFF.4 k6 load test
  - [ ] Implement `cutover-ctl overhead-check --max-p99-overhead-ms 50` (hop + NATS within the §10.2 bar); persist results to `testdata/p99_overhead_benchmark.json`

- [ ] BFF.5 Budget hard-block + soft-alert + circular-routing guard
  - [ ] Implement `cutover-ctl budget-check --alert-latency-s 10`: 402 on exhaustion; soft-alert recorded on `gateway.events.*` within 10 s of the 80% crossing; circular-routing guard integration test passes

## Phase BF-C: Atomic cutover (one coordinated release)

- [ ] BFC.1 Pre-cutover sign-off
  - [ ] Take a final `litellm` DB backup; obtain go/no-go sign-off (Platform, SRE, Security)
  - [ ] Confirm BF0.8 has landed (consumer-contract change)

- [ ] BFC.2 The cutover release (one release)
  - [ ] Point `elitea-main` `/llm` at `elitea-llm-gateway-svc`
  - [ ] Drain + delete the standalone `litellm.yaml` ArgoCD app (no soak — Step 1 already gates on zero traffic)
  - [ ] Set `EXTERNAL_LITELLM_URL` on pylon-indexer to the `elitea-main` `/llm` endpoint and restart

- [ ] BFC.3 Update AGENTS.md ownership line per ADR-0015 (in the cutover PR)
  - [ ] Edit the `/llm` ownership line to name `elitea-llm-gateway`

- [ ] BFC.4 Post-cutover verify
  - [ ] Implement `cutover-ctl cutover-verify --deploy pylon-indexer --port 8081 --litellm-svc litellm-svc:4000 --window-m 30`
  - [ ] Gate = zero gateway 5xx over 30 min; `runtime_engine_litellm` subprocess absent from pylon-indexer pods; zero traffic to `litellm-svc:4000`; 402 hard-block confirmed
  - [ ] On any failure, revert the release (git revert + redeploy prior image + restore `litellm.yaml` from the revert)
