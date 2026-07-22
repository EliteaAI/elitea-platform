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

- [ ] BF0.3a Prove SSE incremental flush (spike — biggest technical unknown, §2.3)
  - [ ] `TestSSEIncrementalFlush`: mock `http.Flusher` with a call counter; assert chunks are written before end-of-response for both OpenAI and Anthropic (both are text/event-stream, differing only in event names)
  - [ ] Spike result documented and accepted; gates cutover

- [ ] BF0.3b Cover the less-exercised whitelisted paths
  - [ ] `TestResponsesAPIRoundTrip`: POST `/llm/v1/responses`; assert HTTP 200, response_format preserved, finish_reason present
  - [ ] `TestCountTokensSubPath`: POST `/llm/v1/messages/count_tokens`; assert HTTP 200, synchronous (non-SSE) body, and that an unknown `/llm/v1/messages/{suffix}` returns 404

- [ ] BF0.4 Budget counter, write-behind, tiered-hybrid fail-mode, and price catalog
  - [ ] Wire the NATS client + JetStream in the gateway and elitea-scheduler: open KV buckets `GATEWAY_BUDGET` / `GATEWAY_ALERT_COOLDOWN` and the `GATEWAY_BUDGET_DELTAS` stream; re-point the EventBus from Redis pub/sub to NATS `gateway.events.*`
  - [ ] Migrations: `project_budget` (+ `nats_fail_mode`, `soft_alert_pct`), `llm_budget_accumulators` (+ `outage_mode`, `reconciled`), `rate_policy` column on `llm_credentials`, `gateway_models` (`input_cost_per_1m_tokens` per-1M denomination, UNIQUE(provider, model_name))
  - [ ] Harden the NATS client: connection Timeout=1s; `context.WithTimeout(ctx,150ms)` on every KV get / Nats-Incr
  - [ ] Implement the NATS `GovernanceStore` (Check*/Update*/Dump*/ResetExpired*) + configStore adapter; wire the governance plugin via `InitFromStore(...)`; enforcement uses `Nats-Incr` on int64 nano-USD counters + circuit breaker (sony/gobreaker); on billed increment, publish a delta to `GATEWAY_BUDGET_DELTAS` with `Nats-Msg-Id = event_id`
  - [ ] Implement JetStream write-behind consumer (budget-writeback durable pull consumer in elitea-scheduler): Fetch → batch delta-UPSERT to `llm_budget_accumulators` → explicit ACK after commit; AckWait/MaxDeliver redelivery + `processed_event_ids` dedup (same txn); stream retention limits (design §8.6)
  - [ ] Implement tiered-hybrid fail-mode FSM (NATS→PG-snapshot fallback; 402 over-limit, 503 stale/down) per design §8.5; add breaker-driven recovery reconciliation goroutine in the gateway
  - [ ] Seed `gateway_models` from pylon centry; implement price-sync worker (24h fetch of LiteLLM `model_prices_and_context_window.json`, PG advisory lock, fail-open on fetch error) per design §8.8
  - [ ] Validate cost math against pylon CostCalculator (per-1M price → nano-USD counter — guard the 1000× bug and keep the two denominations distinct)

- [ ] BF0.4b Disjoint-row integration test
  - [ ] `TestDisjointRowWriteBack`: write-back consumer (NOT outage_mode) and recovery reconciliation (outage_mode AND NOT reconciled) touch disjoint rows — no double-count, incl. post-recovery resume

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
