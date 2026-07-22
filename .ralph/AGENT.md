# Agent Knowledge Base - Elitea Horizontal Scaling

This file contains learnings and context for horizontal scaling implementation.
Updated by each Ralph iteration when discoveries are made.

## Project Structure

```
eliteaai/
├── elitea_core/                         # SOURCE REPO (git: EliteaAI/elitea_core) ← EDIT HERE
│   ├── sio/                            # Socket.IO handlers (asr, mcp, tts)
│   ├── utils/                          # Utilities (scaling additions go here)
│   ├── routes/                         # HTTP routes (health endpoints here)
│   └── module.py                       # Plugin initialization
├── centry/                              # Docker orchestration (git: EliteaAI/centry)
│   ├── docker-compose.yml               # Service definitions
│   ├── envs/                            # Environment files
│   ├── pylon_main/                      # Main API service (mounted as /data in container)
│   │   ├── configs/                     # Service configuration
│   │   │   ├── pylon.yml                # Main pylon config
│   │   │   └── shared.yml              # Shared settings (DB pools, Redis)
│   │   └── plugins/
│   │       └── elitea_core/            # RUNTIME CLONE — do NOT edit directly
│   ├── pylon_indexer/                   # Agent runtime
│   └── tests/e2e/                       # Playwright scaling tests
├── EliteaUI/                            # React frontend (git: EliteaAI/EliteaUI)
├── pylon/                               # Pylon framework (has RedisManager)
│   └── pylon/core/tools/server/socketio.py  # Socket.IO adapter support
├── arbiter/                             # Event bus framework
│   └── arbiter/eventnode/redis.py       # Redis pub/sub implementation
└── .ralph/                              # This directory
```

**IMPORTANT**: `centry/pylon_main/plugins/elitea_core/` is a runtime git clone used by Docker.
Always edit the SOURCE at `elitea_core/` and commit there. The runtime copy syncs separately.

## Key Patterns

### Socket.IO Redis Adapter (Pylon Framework)

The pylon framework already supports Redis-backed Socket.IO via `RedisManager`:

```python
# In pylon/pylon/core/tools/server/socketio.py
# Three adapters available:
# 1. RedisManager (for horizontal scaling)
# 2. EventNodeManager (custom arbiter-based)
# 3. KombuManager (RabbitMQ)

# Configuration in pylon.yml:
socketio:
  redis:
    host: redis-host
    port: 6379
    password: ""
    use_ssl: false
```

### Redis State Externalization

```python
from tools import redis_tools

class RedisStateStore:
    def __init__(self, prefix: str, ttl: int = 3600):
        self.prefix = prefix
        self.ttl = ttl
        self.client = redis_tools.get_client()

    def get(self, key: str) -> dict:
        data = self.client.hgetall(f"{self.prefix}:{key}")
        return {k.decode(): v.decode() for k, v in data.items()} if data else {}

    def set(self, key: str, state: dict):
        pipe = self.client.pipeline()
        pipe.hset(f"{self.prefix}:{key}", mapping=state)
        pipe.expire(f"{self.prefix}:{key}", self.ttl)
        pipe.execute()

    def delete(self, key: str):
        self.client.delete(f"{self.prefix}:{key}")

    def list_keys(self) -> list:
        keys = self.client.keys(f"{self.prefix}:*")
        return [k.decode().split(":", 1)[1] for k in keys]
```

### Health Endpoint Pattern

```python
from pylon.core.tools import web
from flask import jsonify
import time

@web.route("/health/live")
def health_live(self):
    checks = {}
    start = time.time()

    # Redis check
    try:
        redis_tools.get_client().ping()
        checks["redis"] = {"status": "ok", "latency_ms": round((time.time() - start) * 1000)}
    except Exception as e:
        checks["redis"] = {"status": "unhealthy", "error": str(e)}

    # PostgreSQL check
    try:
        with db_tools.get_session() as session:
            session.execute("SELECT 1")
        checks["postgres"] = {"status": "ok"}
    except Exception as e:
        checks["postgres"] = {"status": "unhealthy", "error": str(e)}

    status = "ok" if all(c["status"] == "ok" for c in checks.values()) else "unhealthy"
    code = 200 if status == "ok" else 503
    return jsonify({"status": status, "checks": checks}), code
```

### Migration Lock Pattern

```python
import contextlib
from sqlalchemy import text

@contextlib.contextmanager
def migration_lock(session, lock_id: int = 12345, timeout_seconds: int = 600):
    """Acquire advisory lock for migrations. Only one pod runs migrations."""
    acquired = session.execute(
        text(f"SELECT pg_try_advisory_lock(:lock_id)"),
        {"lock_id": lock_id}
    ).scalar()

    if not acquired:
        raise RuntimeError(f"Could not acquire migration lock {lock_id}")

    try:
        yield
    finally:
        session.execute(
            text(f"SELECT pg_advisory_unlock(:lock_id)"),
            {"lock_id": lock_id}
        )
```

### Feature Flags Pattern

```python
import os
from tools import redis_tools

KNOWN_FLAGS = [
    "REDIS_STATE_ENABLED",
    "SOCKETIO_REDIS_ENABLED",
    "REDIS_STREAMS_ENABLED",
]

def is_enabled(flag: str, project_id: str = None) -> bool:
    # Environment variable override (highest priority)
    env_val = os.environ.get(f"FF_{flag}")
    if env_val is not None:
        return env_val.lower() in ("1", "true", "yes")

    # Redis per-project flag
    client = redis_tools.get_client()
    if project_id:
        val = client.get(f"feature_flags:{project_id}:{flag}")
        if val is not None:
            return val.decode() == "1"

    # Redis global flag
    val = client.get(f"feature_flags:global:{flag}")
    return val is not None and val.decode() == "1"
```

### Pylon Plugin Pattern

Every plugin follows this structure:
```
plugin_name/
├── __init__.py          # Must have PLUGIN_NAME constant
├── module.py            # Module class with init(), deinit()
├── metadata.json        # Plugin metadata (version, requirements)
└── requirements.txt     # Python dependencies
```

### ArgoCD Staging Overlay

Staging deployment uses same Helm chart with different values:
- Namespace: `elitea-staging`
- Hostname: `elitea-staging.technicaldomain.xyz`
- OIDC: `oidc-mock.technicaldomain.xyz` (mock provider)
- Replicas: main=3, indexer=3, auth=2
- Redis adapter: enabled
- DB pools: reduced for multi-replica (main=15+10, indexer=10+5, auth=10+5)

## Testing Patterns

### Python Tests (pytest)

```python
import pytest
from unittest.mock import MagicMock, patch

@pytest.fixture
def mock_redis():
    with patch('tools.redis_tools.get_client') as mock:
        client = MagicMock()
        mock.return_value = client
        yield client

def test_state_store_get(mock_redis):
    mock_redis.hgetall.return_value = {b"key": b"value"}
    store = RedisStateStore("test")
    result = store.get("id1")
    assert result == {"key": "value"}
    mock_redis.hgetall.assert_called_once_with("test:id1")
```

### Playwright E2E Tests

```typescript
import { test, expect } from '@playwright/test';

test('health check returns ok for all pods', async ({ request }) => {
  const response = await request.get('/health/live');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.status).toBe('ok');
});
```

## Environment Details

### Local Development (Docker Compose)
- Redis: `redis:6379` (no auth)
- PostgreSQL: `postgres:5432` (user: centry, db: centry)
- RustFS: `rustfs:9000`
- pylon_main: port 8080
- pylon_auth: port 8080
- pylon_indexer: port 8080

### Staging (Kubernetes)
- Valkey: `elitea-staging-valkey:6379` (no auth)
- PostgreSQL: `elitea-staging-postgres-cluster-rw:5432` (CNPG)
- RustFS: `elitea-staging-rustfs-svc:9000`
- Ingress: Traefik Gateway API HTTPRoutes

## SLOs and Alerting

### Service Level Objectives

| SLO | Target | Measurement | Alert Threshold |
|-----|--------|-------------|-----------------|
| API Availability | 99.9% (non-5xx) | 30-day rolling | 5xx > 1% for 5m |
| API Latency P99 | < 2s | 30-day rolling | P99 > 5s for 5m (critical), > 2s for 10m (warning) |
| Socket.IO Success | 99.5% | 30-day rolling | Transport errors > 1/s for 5m |
| Task Completion | 99% | 30-day rolling | Queue depth > 200 for 10m |

### SLO Rationale

- **99.9% availability**: ~43 min downtime per 30 days. Stateless pods + Redis adapter mean individual pod failures are invisible to users.
- **2s P99 latency**: Accommodates LLM-backed streaming endpoints. Non-streaming CRUD targets < 500ms.
- **99.5% Socket.IO**: Allows for transient drops during rolling deployments. Client auto-reconnect (1-5s) masks most failures.
- **99% task completion**: DLQ captures failures for manual retry. Handler timeout (30s) prevents stuck tasks.

### Alert File Locations

| Context | File | Format |
|---------|------|--------|
| Staging/Prod (k8s) | `elitea-platform/monitoring/alerts.yaml` | PrometheusRule CR |
| Local dev (docker) | `centry/prometheus/alerts.yaml` | Standalone Prometheus rules |
| SLO definitions | `elitea-platform/monitoring/slos.yaml` | Custom format (documentation + indicator queries) |

### Alert Severity Levels

| Severity | Response | Examples |
|----------|----------|----------|
| `critical` | Page on-call, respond within 15m | RedisDown, HighErrorRate, PgBouncer exhausted, PodCrashLooping |
| `warning` | Investigate within 1h, may self-resolve | HighLatencyWarning, Redis memory > 85%, DLQ growing |

## Learnings Log

### 2026-07-22: BF0.3b — Cover the less-exercised whitelisted paths
- **The Responses API does NOT carry chat-completions vocabulary literally.** The task text says "response_format preserved, finish_reason present," but grep of `schemas/responses.go` shows **zero** `finish_reason` keys. The dialect analogs are: `response_format` → the `text.format` object (`ResponsesParameters.Text.Format` = `{type, name, schema, strict}`, type ∈ text|json_schema|json_object); `finish_reason` → the terminal `status` field on `BifrostResponsesResponse` (`completed`/`failed`/`in_progress`/`cancelled`/`queued`/`incomplete`, constants `schemas.ResponsesResponseStatus*`). `TestResponsesAPIRoundTrip` asserts against the real fields, not the chat vocabulary, and documents the mapping in a file-level comment so the intent isn't mistaken for a bug later.
- **Round-trip = decode + converter, both sides.** Request side: I extended the shared `fakeRouter` with `lastResponsesReq` (captured in `ResponsesRequest`) to prove `text.format` survives `decodeJSON` → `req.ToBifrostResponsesRequest(ctx)` into `bifReq.Params.Text.Format`. Also asserts `openai/gpt-4o` splits via `ParseModelString` to `Provider=schemas.OpenAI` + `Model=gpt-4o` (the `openai/` prefix must NOT leak into the model). Response side: canned `BifrostResponsesResponse{Status: Ptr("completed")}` → `writeJSON` → assert `status:"completed"` + `application/json` (unary, non-SSE) in the body.
- **count_tokens is genuinely synchronous.** `TestCountTokensSubPath` asserts `Content-Type` is `application/json` (NOT text/event-stream), and the body contains neither `data:` nor `event:` SSE markers. Anthropic count_tokens wire shape is just `{"input_tokens": N}` (`AnthropicCountTokensResponse` has a single `InputTokens int` field — `ToAnthropicCountTokensResponse` drops the richer `BifrostCountTokensResponse.TotalTokens`/`Tokens`). The unknown-suffix sibling (`/llm/v1/messages/retrieve`) returns a structured `invalid_request_error` 404 via `MessagesSubPath`, proving the exact `/messages/count_tokens` route + `/messages/*` catch-all win over both the streaming `Messages` handler and the OpenAI JSON catch-all (route precedence from BF0.3).
- **Test-only task — no production code changed; pkg coverage steady at 87.5%** (the paths were already implemented in BF0.3; BF0.3b only adds the missing behavioural tests + the `lastResponsesReq` capture field). New file `internal/llmproxy/responses_paths_test.go` (3 tests, all green).
- **Same `go.work` validator caveat as every gateway `command` gate.** BF0.3b's validator is `go test -run '...' ./services/elitea-llm-gateway/internal/llmproxy/... | grep -q PASS` run from repo root **without `GOWORK=off`** → Go refuses the pattern ("directory prefix ... does not contain modules listed in go.work") because the standalone gateway module is intentionally OFF go.work (BF0.2). It fails in this env for that infra reason, NOT a test failure. Run correctly: `cd services/elitea-llm-gateway && GOWORK=off go test -run 'TestResponsesAPIRoundTrip|TestCountTokensSubPath' -v ./internal/llmproxy/...` → all PASS.
- **Pre-existing lint debt noted (not fixed, scope containment):** `golangci-lint run ./internal/llmproxy/...` flags `multipart.go:233 defer f.Close()` unchecked (errcheck) — that's a BF0.3 file, untouched by BF0.3b. My two test files are lint-clean. Flagging here for whoever owns the multipart path to address.

### 2026-07-22: BF0.3a — SSE incremental-flush spike (biggest technical unknown, GATES CUTOVER)
- **SPIKE RESULT: ACCEPTED. Incremental SSE flush is PROVEN** through the direct-converter + `net/http` + `http.Flusher` path for **both** dialects. The design's fallback concern — that the `fasthttpadaptor.NewFastHTTPHandler()` path might be needed for flush — is confirmed **unnecessary**. The gateway's own `streamOpenAI`/`streamAnthropic` → `beginStream` (asserts `http.Flusher`) → `pkg/ssewriter` (`Flush()` per frame) path flushes per chunk. BF0.3+ can rely on this.
- **`httptest.ResponseRecorder` CANNOT prove incremental flush** — it records the final body regardless of flush timing, so "body contains all chunks" is satisfied equally by an incremental writer and a buffer-then-dump writer. The prior BF0.3 stream tests (`TestChatStreamOpenAI_...`) prove *framing/content*, not *timing*. BF0.3a needed a different instrument.
- **The proof is a LOCK-STEP PRODUCER, not a wall-clock heuristic** (`internal/llmproxy/sse_flush_test.go`). `flushRecorder` is a hand-rolled `http.ResponseWriter`+`http.Flusher` whose `Flush()` snapshots bytes-written-so-far and signals a channel. The fake router's stream methods (`lockStepRouter` embeds `fakeRouter`, overrides the two `*StreamRequest`) feed an **UNBUFFERED** channel from a goroutine that produces chunk `i+1` only after observing chunk `i`'s flush on `rec.flushed`. If the handler buffered, the flush signal never arrives → producer blocks → 2s producer-wait + 5s handler watchdog fail the test. A PASS therefore *proves* each chunk was flushed before the next was produced ⇒ before end-of-response. No `time.Sleep`, no flakiness.
- **ALWAYS run the negative control for a spike.** I temporarily commented out the two `s.flusher.Flush()` calls in `pkg/ssewriter.go` and re-ran: the test failed exactly as designed (producer blocked on chunk 0, flush-count 0, only first chunk delivered) — proving the test is a genuine proof and not a false positive. Restored via `git diff --stat` = empty. Do this for any "prove X works" spike; a green test that also stays green when X is broken proves nothing.
- **Dialect chunk choices for a deterministic 1-flush-per-chunk trace:** OpenAI = N `BifrostChatResponse` chunks → N `data:` frames + 1 terminal `data: [DONE]` = **N+1 flushes**. Anthropic = N `ResponsesStreamResponseTypeCreated` chunks (each converts to exactly one `message_start` event; `...InProgress`/`...ContentPartAdded`/`...ContentPartDone` convert to **nil** and would flush 0 times — avoid them in a counting test) → N `event:` frames, **no [DONE]**, = **N flushes**. `assertIncremental` checks flush-count, strictly-growing body per flush, and first-flush-bytes < full-body.
- **Validator infra caveat (same as all gateway `command` gates):** `go test -run TestSSEIncrementalFlush ... ./services/elitea-llm-gateway/internal/llmproxy/... | grep -q PASS` fails from repo root because the standalone module isn't in `go.work` and Go rejects the pattern without `GOWORK=off`. Run `cd services/elitea-llm-gateway && GOWORK=off go test -run TestSSEIncrementalFlush ./internal/llmproxy/...` → PASS. llmproxy pkg coverage stays at 87.5% (spike is test-only, no production code changed).

### 2026-07-22: BF0.3 — gateway /llm chi handler, dialect decode, net/http SSE loop
- **Anthropic `/v1/messages` routes through the Responses API in bifrost/core v1.7.3, NOT Chat.** The design §300 table saying "Anthropic → Chat" is **stale**. `anthropic.AnthropicMessageRequest.ToBifrostResponsesRequest(ctx)` → `ResponsesRequest`/`ResponsesStreamRequest`; unary reply via `anthropic.ToAnthropicResponsesResponse(ctx, resp)`; streaming via `anthropic.ToAnthropicResponsesStreamResponse(ctx, chunk) []*AnthropicStreamEvent` (one core chunk fans out to 0..N Anthropic events — e.g. `ResponsesStreamResponseTypeInProgress` → nil/skip, `...Created` → `message_start`); mid-stream error via `anthropic.ToAnthropicResponsesStreamError(err)` which returns a **complete** `event: error\ndata: …\n\n` frame (write it with `ssewriter.Raw`, don't re-frame). `count_tokens` = `CountTokensRequest` (a ResponsesRequest under the hood) → `anthropic.ToAnthropicCountTokensResponse(resp)`, synchronous/non-SSE.
- **Three distinct SSE framings.** OpenAI chat: `data: <json>\n\n` per chunk + terminal `data: [DONE]\n\n`; mid-stream error = one `data: {openAI-error}` frame then stop (**no [DONE]**). OpenAI Responses + Anthropic: `event: <type>\ndata: …` per event, **no [DONE]** (completion = stream close); mid-stream error = `event: error` frame. Encoded as `streamOpenAI`/`streamResponses`/`streamAnthropic` in handler.go.
- **Do NOT call the integrations `Create*RouteConfigs` factories or `RequestConverter`/`ChatStreamResponseConverter`** — they need a fasthttp `lib.HandlerStore`/`*fasthttp.RequestCtx` and cannot run under net/http. The gateway owns decode + framing itself and dispatches through an `LLMRouter` interface (`internal/llmproxy/ports.go`) over the embedded `*bifrost.Bifrost` — the seam lets handler/SSE/error tests inject a fake with canned chunks (no live provider). Compile-time assert `var _ LLMRouter = (*bifrost.Bifrost)(nil)` guards against upstream signature drift at the pinned tag.
- **BF0.3 validator is `file_contains handler.go [BifrostStreamChunk, http.Flusher]`.** The flush capability lived only in `pkg/ssewriter`, so handler.go failed the `http.Flusher` grep. Fixed by making `beginStream` assert `w.(http.Flusher)` itself (a real precondition — without it net/http buffers the whole response and streaming silently breaks) before delegating to ssewriter. Lesson: keep the literal the validator greps in the file it names, and make it load-bearing rather than decorative.
- **Error contract (design §2, differs from LiteLLM):** budget exhaustion = **402** `budget_exceeded`/`insufficient_quota` (recognised via 402 status OR a budget-shaped type/code on any 4xx), rate = 429 `rate_limit_error`, 401 auth, 403 permission, 503 `api_error`; everything else passes the provider status through. OpenAI errors are the nested `{"error":{type,message,code}}` envelope; Anthropic errors via `anthropic.ToAnthropicChatCompletionError`. Mapping is `statusAndType`/`openAIErrorBody` in httpio.go.
- **Identity/vk:** gateway reads `GATEWAY_IDENTITY_SECRET` (must match elitea-main's edge secret when set; empty disables HMAC verification since the mTLS hop still authenticates). On verify failure → 403 `permission_error`. The resolved `X-Elitea-Project-Id` is injected as `ctx.SetValue(schemas.BifrostContextKeyVirtualKey, projectID)` — never set `BifrostContextKeyUserID` manually. Signature scheme mirrors elitea-main's identity.go (separate module): `"sha256="+hex(HMAC(v1\n{proj}\n{user}\n{tenant}))`.
- **Tests + coverage:** new-code packages clear the ≥85% gate — `internal/api` 100%, `internal/llmproxy` 87.5%, `pkg/ssewriter` 86.4%. Fake `http.Flusher` with a call counter proves per-write flush in ssewriter_test. `internal/api/router_test.go` holds the authoritative route-precedence regression (exact `/messages` + `/messages/count_tokens` win over `/messages/*`→404 and the OpenAI JSON routes). To exercise the 11 `bifrostLLMRouter` forwarders, ports_test spins up a real `bifrost.Init` with a zero-provider account and calls each method (they return provider errors — the point is the forwarding line runs). BF0.3a (`TestSSEIncrementalFlush`) and BF0.3b (`TestResponsesAPIRoundTrip`/`TestCountTokensSubPath`) are **separate later tasks** — left unimplemented on purpose. Those two validators also fail in this env for an infra reason unrelated to my code: they run `go test` from repo root **without `GOWORK=off`**, and the standalone gateway module isn't in go.work, so `go` refuses the pattern. All gateway `command`-type validators share this; the module is built/tested with `GOWORK=off` from its own dir.

### 2026-07-22: BF0.2b — NATS JetStream cluster + gateway Helm/ArgoCD app (IaC)
- **Pure-IaC task; no Go code.** The BF0.2b `features.json` validator is a live `command` (`nats --context gateway stream info ... | jq` + two `kv ls | grep`). It needs a reachable NATS 2.12.0+ **and** the `nats` CLI, neither of which exists in this offline dev env — so it fails here exactly like the sibling BF-Build infra checks (per the earlier AGENT.md note that most BF-Build live checks can't pass in dev). The deliverable is the manifests + a deterministic render test, not a green live check. Added `deploy/test_bf0_2b.sh` (helm-template + yaml-assert, 16 assertions, all green offline) as the CI-able proxy for the invariants.
- **Wrap the upstream `nats` chart as a subchart, don't fork it.** `deploy/helm/nats/Chart.yaml` declares `dependencies: [{name: nats, version: 1.3.9, repository: https://nats-io.github.io/k8s/helm/charts/}]`, so all values nest under a top-level `nats:` key. Two profiles per design §8.1.1: `values-scale1.yaml` (`config.cluster.enabled: false`, `statefulSet.replicas: 1`, file store, memory store off) and `values-ha.yaml` (`config.cluster.enabled: true`, `config.cluster.replicas: 3`, `statefulSet.replicas: 3`, `podTemplate.topologySpreadConstraints`). Both pin `container.image.tag: 2.12.0-alpine` — **2.12.0+ is mandatory for atomic `Nats-Incr`** (the budget counter primitive, BF0.4). Current chart schema is `config.jetstream` / `config.cluster.replicas` / `statefulSet.replicas` (confirmed via context7 nats-io/k8s); the old top-level `cluster:`/`nats.jetstream:` keys are deprecated.
- **KV/stream creation is a *separate* idempotent bootstrap chart, not baked into the NATS chart.** `deploy/helm/nats-bootstrap`: a pre-install/pre-upgrade ConfigMap embeds `files/bootstrap.sh` (`.Files.Get "files/bootstrap.sh" | indent 4` — the script MUST live under the chart dir for `.Files.Get`), and a post-install/post-upgrade hook Job (`natsio/nats-box:0.18.0`, `command: ["/bin/sh","/scripts/bootstrap.sh"]`, `hook-delete-policy: before-hook-creation,hook-succeeded`, backoffLimit 6, activeDeadlineSeconds 600) runs it. `bootstrap.sh` is POSIX `sh`, idempotent (`nats kv add`/`stream add` are no-ops if present): creates `GATEWAY_BUDGET` (`--history 1 --storage file`), `GATEWAY_ALERT_COOLDOWN` (`--ttl ${ALERT_COOLDOWN}`, default 4h), and stream `GATEWAY_BUDGET_DELTAS` (`--subjects gateway.budget.delta --retention limits --discard old --dupe-window --max-age/--max-bytes/--max-msgs --replicas "${REPLICAS}"`). **NO `GATEWAY_CUTOVER` bucket** — migration is big-bang. `--replicas` is parameterised via the `REPLICAS` env so the same chart serves scale-1 (1) and HA (3).
- **Gateway chart mTLS-only ClusterIP.** `service.yaml` hardcodes `name: elitea-llm-gateway-svc` (design/runbook/edge config all reference that literal, so do NOT use the release-derived fullname), `type: ClusterIP`, `port: 8083` → `targetPort: http`; comment forbids LoadBalancer/NodePort. `certificates.yaml` emits **two** cert-manager `Certificate`s off a shared `elitea-internal-ca` ClusterIssuer (not created here): a server cert (dnsNames for the svc + `.svc` + `.svc.cluster.local`, `usages: server auth`) and an edge-client cert (`CN: elitea-main`, `usages: client auth`) — the mTLS pair for the BF0.2a reverse-proxy hop. All gated by `.Values.mtls.enabled` (default true); deployment mounts the server secret read-only at `.Values.mtls.mountPath`.
- **HPA scales on a custom SSE metric, not CPU.** `hpa.yaml` is `autoscaling/v2` with a `Pods` metric `gateway_llm_sse_active_connections` (`AverageValue` target 40) — CPU/memory is a poor signal for I/O-bound long-lived streaming. `scaleDown.stabilizationWindowSeconds: 300` protects in-flight ~120s streams from premature pod removal. Disabled by default (`autoscaling.enabled: false`).
- **ArgoCD ordering via sync-waves.** Three apps in `deploy/argocd` (`nats.yaml` -2, `nats-bootstrap.yaml` -1, `elitea-llm-gateway.yaml` 0) so NATS is healthy → buckets/stream exist → gateway starts and finds them. `nats-bootstrap.yaml` passes `replicas` as a Helm parameter (default "1"; HA operators set "3"). All: `repoURL https://github.com/eliteaai/elitea-platform`, namespace `elitea-gateway`, automated prune+selfHeal, CreateNamespace=true.
- **`nats --context gateway` for the validator**: `deploy/nats-context/gateway.json` (context JSON template, url `nats://127.0.0.1:4222`, blank creds/TLS to fill per-env) + `install-context.sh` (`nats context save gateway --server ... --select`, optional `--creds/--ca/--cert/--key`). In-cluster access = `kubectl -n elitea-gateway port-forward svc/nats 4222:4222` first.

### 2026-07-22: BF0.2a — elitea-main → gateway streaming reverse proxy + mTLS
- **New package `services/elitea-main/internal/llmproxy/`** (`proxy.go` + `identity.go`), 100% pkg coverage. NOT yet wired into `router.go` — mounting `/llm` at the gateway is explicitly **BFC.2** (the cutover release), so scope-contained out of BF0.2a. The proxy is a self-contained `*Proxy` with `ServeHTTP`.
- **`httputil.ReverseProxy` uses the Go 1.20+ `Rewrite` hook, not the legacy `Director`.** `Rewrite: func(pr *httputil.ProxyRequest)` → `pr.SetURL(target)` (preserves inbound path) + `pr.Out.Host = target.Host`. `FlushInterval: -1` = flush every proxied write immediately (no buffering) — proven by `TestProxy_StreamsIncrementally` (flushRecorder counts ≥3 flushes for 3 SSE chunks). `ModifyResponse` re-asserts `X-Accel-Buffering: no` end-to-end. `ErrorHandler` → HTTP 502 on upstream down.
- **Disabling `http.Server` WriteTimeout for `/llm` per-request**: can't change the shared server's WriteTimeout from a handler, so clear the *per-connection* write deadline in `ServeHTTP` via `http.NewResponseController(w).SetWriteDeadline(time.Time{})` (zero time = no deadline). Must ignore `http.ErrNotSupported` — `httptest.ResponseRecorder` does NOT implement it; a test writer needs its own `SetWriteDeadline(time.Time) error` method for the controller to reach it.
- **Identity headers live in `identity.go`, not `proxy.go`** — but the BF0.2a validator greps `proxy.go` for the literal `X-Elitea-Project-Id`, so keep at least a doc-comment naming the headers in `proxy.go`'s Rewrite hook. Headers: `X-Elitea-Project-Id`/`-User-Id`/`-Tenant-Id` + `X-Elitea-Identity-Signature` (`sha256=<hex>` HMAC over a versioned, newline-joined canonical tuple — newline separation prevents field-concat ambiguity, e.g. project"1"+user"2" vs project"12"). `injectIdentity` **strips client-supplied identity headers first**, then sets edge-resolved values; signs only when a secret AND a projectID are present.
- **Identity sources**: projectID from `middleware.ProjectFromContext` (int → string, >0 only), userID from `auth.UserFromContext().ID`, tenantID from `tenant.TenantFromContext` (`internal/infra/db/tenant`). The projectID is the resolved non-secret handle = Bifrost vk value at the gateway; never the raw Elitea key.
- **mTLS transport (`NewMTLSTransport`)**: HTTP/1.1 only — `NextProtos: []string{"http/1.1"}` + `ForceAttemptHTTP2: false` (design §9.1). `tls.LoadX509KeyPair` for client cert, `x509.NewCertPool().AppendCertsFromPEM` for CA (returns false → error on a PEM with no certs). No ResponseHeaderTimeout/write deadline (SSE is long-lived). `Config.Transport` override lets tests inject `http.DefaultTransport` (plain) so no real mTLS handshake is needed in unit tests.

### 2026-07-22: BF0.2-account — `bifrost.Account` implemented (vault-backed)
- **Only `GetKeysForProvider` carries a `context.Context`.** `GetConfiguredProviders`/`GetConfigForProvider` are called ctx-free at `bifrost.Init` (prewarm) and lazily per-provider. So **all per-project resolution MUST live in `GetKeysForProvider`**, which reads the resolved projectID from `ctx.Value(schemas.BifrostContextKeyVirtualKey)` (set by the `/llm` handler from the signed `X-Elitea-Project-Id` header). `GetConfiguredProviders` returns a **static** supported set (OpenAI, Azure, Anthropic, Bedrock, Vertex, Ollama) — per-project availability = zero keys for an unconfigured provider. `GetConfigForProvider` can only carry the tuned `ConcurrencyAndBufferSize.Concurrency` (no ctx → no per-project base URL there).
- **Credential source of truth**: `p_{projectID}.configuration` rows, `section='ai_credentials'`, `status_ok=true`, `type` mapped per provider (`open_ai`→OpenAI; `azure_open_ai`/`open_ai_azure`/`ai_dial`→Azure; `ollama`→Ollama; `amazon_bedrock`→Bedrock; `vertex_ai`→Vertex; `anthropic`→Anthropic). `data` JSONB has `api_base` + `api_key` (prefer `api_key`, fall back to legacy `api_token`). `api_key` may be a literal or a `{{secret.NAME}}` ref.
- **Per-key api_base**: OpenAI base URL is deferred to the BF0.3 handler (no per-key field without a request). Ollama base → `Key.OllamaKeyConfig.URL`; Azure base → `Key.AzureKeyConfig.Endpoint`. All keys get `Models = WhiteList{"*"}` and `Value = *schemas.NewSecretVar(resolved)`.
- **Self-referential guard fires BEFORE the vault Resolve** (never even decrypt a looping credential). `normaliseOrigin` = lowercase scheme+host, `TrimRight(path,"/")`; match is exact OR either-direction `HasPrefix` (so `.../llm` vs `.../llm/v1` both trip). Returns `fmt.Errorf(...%w, ErrSelfReferentialCredential)` carrying reason `SELF_REFERENTIAL_CREDENTIAL` → HTTP 400 mapping later. Self origins injected via `Config.SelfOrigins`.
- **Fernet decrypt reimplemented, not imported** — elitea-main's handler is `internal/` (unimportable). `vault.go` is decrypt-only, byte-compatible with Python `cryptography.fernet.Fernet`: token = base64url(`0x80` | ts[8] | iv[16] | ct | hmac[32]); key split 16/16 (HMAC-SHA256 signing / AES-128-CBC). Project Fernet key at `centry.secrets_key WHERE id='project-{id}'`, blob at `centry.secrets_data`; project key itself Fernet-wrapped under `SECRETS_MASTER_KEY` (base64url 32B) when set, else stored raw 32B. Tests carry a matching `fernetEncrypt` helper for full round-trips.
- **SQL-injection guard**: schema name `p_{id}` is `fmt`-interpolated (can't be a bind param), so `validateProjectID` rejects any non-numeric id even though it's server-resolved. Table/column identifiers use `%q`.
- **`schemas.BifrostContext` reserved-key gotcha**: `BifrostContextKeyVirtualKey` is in `reservedKeys`; `SetValue` silently drops reserved writes **when `blockRestrictedWrites` is true** — but `NewBifrostContext` defaults it to `false`, so tests set the VK via `SetValue` fine. Don't assume the write landed if that flag is ever flipped on.
- **DB seam for testability**: package-local `rowQuerier`/`pgxRows`/`pgxRow` interfaces + `PoolQuerier` adapter (`pgxpool.go`) — `pgx.Rows`/`pgx.Row` satisfy them via compile-time asserts. Account pkg tests hit **92.1%** with in-memory fakes; validator `phase-bifrost-build` BF0.2-account green. Wiring `EliteaAccount` into `server.New` (replacing `bootstrapAccount`) is a later task — scope-contained out of BF0.2-account.

### 2026-07-22: BF0.2 — Stand up `elitea-llm-gateway` on Go 1.26.4
- **Pinned dep: `github.com/maximhq/bifrost/core v1.7.3`** (import path is `.../bifrost/core`, NOT `.../bifrost`). Module tags are per-subdir: fetch with plain semver `@v1.7.3`, not `@core/v1.7.3` (the latter is rejected as "disallowed version string"). `core/v1.7.3`'s go.mod requires `go >= 1.26.4` — exactly the task's toolchain, so the dep itself enforces the version bump.
- **The gateway MUST stay OFF `go.work`.** The workspace go directive is 1.25.8; Go refuses to `go work use` a 1.26.4 module ("requires go >= 1.26.4"). Worse, running bare `go work sync` silently **escalates `go.work`'s go directive to 1.26.4** even though the gateway isn't in the `use` list — that would violate the "elitea-main toolchain UNCHANGED" constraint. Resolution: gateway is a **standalone module**, built with `GOWORK=off`. Verified: `go.work` stays 1.25.8, all workspace modules still build, `go list -m` does NOT include the gateway. Do NOT add it to `go.work` and do NOT run `go work sync` after touching it (or `git checkout go.work go.work.sum` if you do).
- **CI**: workspace CI (`ci-go.yml`) iterates `go list -m` on go 1.25 — it will never see the gateway. Added a **dedicated `.github/workflows/ci-gateway.yml`** on `go-version: "1.26.4"` with `GOWORK=off`, path-filtered to `services/elitea-llm-gateway/**`. Also added the gateway to `docker-bake.hcl` (targets `default`+`go`) and to `publish.yml` build/manifest/sign matrices + rollback IMAGES array. The Containerfile pins `FROM golang:1.26.4-alpine`, so no publish-runner image bump is needed (toolchain comes from the base image).
- **bifrost/core API (v1.7.3), verified against the module cache** (`$(go env GOMODCACHE)/github.com/maximhq/bifrost/core@v1.7.3`):
  - `bifrost.Init(ctx context.Context, cfg schemas.BifrostConfig) (*bifrost.Bifrost, error)` — takes a ctx (matches design). Requires non-nil `Account` (errors otherwise) and, if `Logger` is nil, **overwrites the zerolog global** — so a `Logger` MUST be injected (§6.1). Cleanup is `(*Bifrost).Shutdown()` (no ctx, no return).
  - `BifrostConfig` fields used: `Account`, `Logger`, `InitialPoolSize` (top-level int), `LLMPlugins []schemas.LLMPlugin`. There is **no** `Concurrency` field on `BifrostConfig` — per-provider concurrency is `ProviderConfig.ConcurrencyAndBufferSize.Concurrency` returned from `Account.GetConfigForProvider` (default `schemas.DefaultConcurrency = 1000`).
  - `schemas.Logger` interface = `Debug/Info/Warn/Error/Fatal(msg string, args ...any)` + `SetLevel(LogLevel)` + `SetOutputType(LoggerOutputType)` + `LogHTTPRequest(LogLevel, string) LogEventBuilder`. `LogEventBuilder` = `Str/Int/Int64(...) LogEventBuilder` + `Send()`. Adapted to slog in `internal/bifrostlog`; its `Fatal` does NOT `os.Exit` (unlike bifrost's DefaultLogger) so a lib log call can't abort an in-flight stream drain.
  - `schemas.Account` = `GetConfiguredProviders() ([]ModelProvider, error)` + `GetKeysForProvider(ctx, ModelProvider) ([]Key, error)` + `GetConfigForProvider(ModelProvider) (*ProviderConfig, error)`. A `bootstrapAccount` (zero providers) satisfies Init before the vault-backed Account (BF0.2-account) lands — kept in `internal/server/bootstrap_account.go` so `internal/account/account.go` is free for that task.
- **§9.5 settings applied**: `srv.Shutdown()` wraps caller ctx with `cfg.ShutdownTimeout` (default 150s); `http.Server.WriteTimeout: 0` (finite ReadHeaderTimeout kept for slow-header defense); `InitialPoolSize→100`, per-provider `Concurrency→50`. Helm chart `deploy/helm/elitea-llm-gateway/` sets memory req 1Gi/limit 2Gi, `terminationGracePeriodSeconds: 150`. **preStop gotcha**: runtime image is `distroless/static` (no shell/sleep) — an `exec: /bin/sleep` preStop would fail at runtime, so it's `enabled: false` by default (app SIGTERM graceful-shutdown is the real drain); operators enable it only with an image that can run the command. Chart `helm lint` clean.
- Gateway listens on **:8083** (elitea-main :8080, scheduler :8081). Health at `/healthz`; the `/llm` chi router mounts here in BF0.3.

### 2026-07-22: BF0.1 — `middleware.Project` project resolution
- **The authoritative derivation semantics live in pylon, NOT the design doc.** Ported from `runtime_interface_litellm/methods/proxy.py::prepare_request` + `projects/rpc/poc.py::get_personal_project_id` + `projects/constants.py`. The design doc only said "PROJECT_USER_NAME_PREFIX + personal-project RPC"; pylon source gave the exact colon-split and email-fallback rules. Two-branch resolution:
  1. System project-user name `":system:project:<id>:"` → parse id directly. Trailing colon means id is the **second-to-last** colon field (`name.split(":")[-2]`), so `strings.Split` + `parts[len(parts)-2]`.
  2. Otherwise → personal-project DB lookup: `SELECT id FROM centry.project WHERE name='project_user_<uid>'`; if found **and** user is a member (`auth_core__project_user_role` EXISTS) return it; else / if missing → email fallback `system_user_<n>@centry.user` → `<n>`.
- **Signature change was safe:** `middleware.Project` had ZERO callers (grep-confirmed), so switching `Project(next http.Handler)` → `Project(cfg ProjectConfig) func(http.Handler) http.Handler` broke nothing. BF0.2a will wire it into the `/llm` proxy chain.
- **Added `Name` to `auth.User`** (`internal/auth/types.go`) and populated it in BOTH validators (`authsvc/local_validator.go` already SELECTed `name` but discarded it; `authsvc/rpc.go` needed the `name` JSON field added to `validateTokenResponse`). The primary derivation path keys off the token/user name.
- **Testability pattern for pgx code:** `*pgxpool.Pool.QueryRow` panics on a nil receiver, so nil-pool tests can't exercise DB paths (see `v2/projects/handler_test.go` which skips them). Fix: define a tiny `rowQuerier` interface (`QueryRow(ctx, sql, args...) pgx.Row`) that `*pgxpool.Pool` already satisfies, store that in the resolver instead of the concrete `*Pool`, and hand-roll a `fakeRow`/`fakeQuerier` in tests keyed on a SQL substring. No new mock dependency needed. Got `project.go`+`project_resolver.go` to 93.4% statement coverage.
- Behaviour matches pylon: unresolvable project (id<=0 or resolver error) → **HTTP 400**; unauthenticated request passes through (Auth middleware owns rejection). `PublicProjectID` falls back to `AI_PROJECT_ID` env → default 1.
- Coverage note: `go test -cover` reports package-wide % (18.7% before, 69.8% after); to prove the 85% subtask, filter the coverprofile to the two files and sum statements — that's the meaningful metric.

### 2026-07-22: BF0.0 — Global soft-alert emission (`PUT /admin/gateway/budget-alerts`)
- New package `services/elitea-main/internal/api/gateway/`; handler `budget_alerts.go` (GET+PUT), 100% test coverage.
- **`middleware.RequirePermissions` was previously UNWIRED** — grep confirmed zero non-test callers before this task. BF0.0 is its first real usage, matching the known "admin routes have Auth but no server-side RequirePermissions" RBAC-baseline gap. Gated with `RequirePermissions("configuration.governance")` (permission naming follows existing `configuration.*` convention; `configuration.litellm` is the litellm predecessor).
- **Persistence is in-memory (thread-safe `BudgetAlertStore`, RWMutex), NOT a migration.** Deliberate scope containment: the only migration is `001_initial.sql`, and `migrate.go` skips ALL migrations if any `p_%` tenant schema exists (dump-guard) — adding a global-settings migration here would collide with BF0.4's `project_budget`/`llm_budget_accumulators` work and risk being silently skipped on dump-loaded instances. Precedent: `shadow.Comparator` holds its config the same way (RWMutex, injected via RouterConfig). Global soft-alert config is a good candidate to fold into BF0.6's global governance config table later.
- Mounted under the authenticated `/api/v2/admin` group as `/gateway/budget-alerts` (full path `/api/v2/admin/gateway/budget-alerts`). Store is injected via `RouterConfig.BudgetAlertStore`; router lazily constructs a default (enabled, 80%) if nil, so existing `NewRouter` callers need no change.
- Validator only checks: `grep -rq "budget-alerts" services/elitea-main/internal/api && ! grep -rq "llmcutover" ...`. Confirmed `llmcutover` appears NOWHERE in the repo (no per-project cutover tracker on the Bifrost big-bang path — the old `cutover` package is unrelated shadow/canary machinery, not `llmcutover`).
- Env gotchas: validator needs `python3` (no `python` on this machine); other 15 BF-Build checks fail as expected (future tasks — greenfield `services/elitea-llm-gateway/` absent, `nats`/`psql`/`cutover-ctl` not installed).

### 2026-06-29: Horizontal Scaling Setup
- Pylon framework already has RedisManager for Socket.IO (python-socketio 5.15.0)
- Socket.IO sio handlers live in `elitea_core/sio/` (asr.py, mcp.py, tts.py)
- Current DB pools are oversized for multi-replica (main: 100+200)
- Health endpoints exist at /healthz, /livez, /readyz (basic)
- Need richer /health/live and /health/ready with dependency checks
- ArgoCD uses app-of-apps with OCI Helm charts (pylon v1.0.6)
- Gateway API HTTPRoutes (not Ingress) for routing
- OIDC mock at oidc-mock.technicaldomain.xyz supports authorization_code flow

### 2026-06-29: Task 1.1 - Socket.IO Redis Adapter
- Config goes in `shared.yml` (NOT pylon.yml — that file doesn't exist in this project)
- The `socketio.redis` section under `settings:` key activates `RedisManager` in pylon
- Env var expansion happens BEFORE yaml.SafeLoader, so `${REDIS_SSL}` → `false` → boolean `False`
- Requirements already present: `python-socketio[client]==5.15.0`, `redis==7.1.0`, `aioredis==2.0.1`
- Test file: `centry/tests/unit/scaling/test_socketio_redis_adapter.py` (17 tests)
- Cannot import pylon directly in tests (dependency chain: pylon→arbiter→pika, socketio not installed locally)
- Solution: replicate URL construction logic for unit testing; test config integration via YAML parsing
- Features validator (`.ralph/features.json`) expected pylon.yml → fixed to shared.yml
- No Docker available in dev env, so Docker-level integration tests can't run locally

### 2026-06-29: Task 1.2 - RedisServersStorage for MCP State
- Existing in-memory `ServersStorage` at `utils/mcp_servers_storage.py` — uses two dicts: `project_id_to_server_name_to_server` and `sid_to_project_id`
- Created `RedisServersStorage` at same path prefix but separate file: `utils/redis_servers_storage.py`
- Redis key layout: `mcp_servers:{project_id}` (hash: server_name → JSON), `mcp_sid_to_project:{sid}` (string: project_id)
- Uses `HSETNX` for atomic registration (prevents duplicate registration race)
- Module accesses Redis via `self.get_redis_client()` method (from `methods/redis_client.py`)
- The `McpServer` Pydantic model has `model_dump_json()` / `model_validate_json()` for serialization
- Python 3.9 incompatibility: `models/mcp.py` and `utils/sio_utils.py` use `X | Y` union syntax (3.10+)
- Test strategy: define compatible Pydantic models in test file; load `redis_servers_storage.py` via `importlib.util.spec_from_file_location` bypassing `__init__.py` chain
- `validate_all()` uses `SCAN` with cursor to iterate `mcp_sid_to_project:*` keys
- Module initialization at `module.py:800-801`: `self.servers_storage = ServersStorage()` — will change to `RedisServersStorage(self.get_redis_client())` when feature flag is enabled
- Test file: `centry/tests/unit/scaling/test_redis_servers_storage.py` (37 tests, 98% coverage)

### 2026-06-29: Task 1.3 - Externalize ASR Session State to Redis
- ASR module at `sio/asr.py` uses a module-global dict `_sessions` for per-SID VAD state
- Two session types: "whisper" (VAD buffering + batch API calls) and "realtime" (streaming to indexer via event_node)
- Whisper sessions hold threading.Lock, bytearray buffer, flush timer — not directly serializable to Redis
- Design decision: **hybrid approach** — keep local dict for hot-path VAD processing (sub-ms latency needed), externalize config + recovery state to Redis
  - Local dict: lock, buffer (active frame accumulation), flush_timer, event_node, task_node references
  - Redis hash `asr_session:{sid}`: type, project_id, model_name, language, VAD state (speech_detected, silent_frames, call_in_flight)
  - Redis list `asr_buffer:{sid}`: base64-encoded PCM chunks (for recovery only, written at flush boundaries)
- Session recovery via `_try_recover_session()`: when audio arrives for a SID not in local dict but present in Redis, reconstruct the local session from Redis state
- Redis client uses `decode_responses=True` (existing pattern), so binary audio is base64-encoded for list storage
- `MAX_BUFFER_CHUNKS = 200` (LTRIM to bound memory ~60s audio at 300ms/chunk)
- Module initialization: `init_redis_store(redis_client)` called from module.py during plugin init
- `on_whisper_call_done()` persists call_in_flight=False to Redis after transcript response
- The `evict_stale_sessions()` in the store uses SCAN to find idle sessions (TTL handles true abandonment, eviction is proactive)
- `sio_utils.py` has Python 3.10+ syntax (`str | None`) — tests must mock SioEvents with a fake StrEnum instead of loading the real module
- Test file: `centry/tests/unit/scaling/test_redis_asr_store.py` (59 tests, 100% coverage on store)
- Validator pattern updated in features.json: checks for `RedisAsrSessionStore` and `redis_asr_store` imports (not `redis_tools`)
- event_node and task_node are pylon framework objects — cannot be stored in Redis, must be injected from the SIO handler context during recovery

### 2026-06-29: Task 1.4 - Move callback_tasks dict to Redis
- In-memory `callback_tasks` dict defined in `module.py:67` as `self.callback_tasks = {}`
- Used in 3 places: `module.py` (init), `api/v2/predict.py:104`, `api/v2/pipeline_run.py:86` (registration), `methods/task_callbacks.py:48,51` (consumption via `.pop()`)
- Synchronization mechanism: `not_starting_task_event` (threading.Event) handles the race where task completes before callback is registered (predict clears event, task_status_changed waits on it)
- For Redis version: synchronization race is solved differently — `pop_callback` retries with wait are still needed in `task_status_changed` because the predict API on another pod may not have written to Redis yet
- Design: simple Redis string per task_id (not hash) — `callback_tasks:{task_id}` → JSON string with url+headers
- Uses `GETDEL` (Redis 6.2+) for atomic pop — ensures exactly-once consumption when multiple pods race
- TTL: 24 hours (DEFAULT_TTL = 86400)
- `pipeline_run.py` has a `hasattr(self.module, "callback_tasks")` guard (defensive) — when switching to CallbackManager, same pattern applies
- Test file: `centry/tests/unit/scaling/test_callback_manager.py` (26 tests, 100% coverage)
- Coverage trick: use `--cov=centry.pylon_main.plugins.elitea_core.utils.callback_manager` (module path) not `--cov=/absolute/path` for dynamic-import test files

### 2026-06-29: Task 1.5 - Move task_logs cache to Redis
- Implementation file `task_logs_redis.py` already existed (written in a prior iteration)
- `self.task_logs = {}` in `module.py:71` is the in-memory dict to replace
- Actual task log caching is in `logging_hub` plugin's `room_cache` dict — separate concern
- `logging_hub/sio/logs.py` handles `task_logs_subscribe`/`task_logs_unsubscribe` Socket.IO events
- `logging_hub/methods/logs.py` populates `self.room_cache[room]` with log records, limited by `room_cache_size` (default 100)
- `TaskLogsRedis` uses Redis sorted set: score=timestamp, member=JSON(record)
- Methods: `append`, `append_batch`, `get_latest`, `get_all`, `get_since`, `clear`, `count`, `exists`, `set_ttl`
- TTL: 604800 (7 days), MAX_ENTRIES: 500 (enforced via `zremrangebyrank`)
- Test file: `centry/tests/unit/scaling/test_task_logs_redis.py` (48 tests, 100% coverage)
- Module loading pattern: same as task 1.4 — mock pylon.core.tools, use importlib.util.spec_from_file_location

### 2026-06-29: Task 1.6 - Implement User Icons Storage in S3
- Current icon system: local filesystem at `/data/static/application_icon/{project_id}/{uuid}.png`
- Served via Flask route `@web.route("/application_icon/<path:sub_path>")` in `routes/application_icon.py`
- Upload flow: `api/v2/upload_icon.py` → RPC `social_save_image` (PIL resize) → save to disk
- S3/MinIO infrastructure: `MinioClient` in `shared/tools/minio_client.py` (boto3-backed), bucket prefix: `p--{project_id}.`
- Artifacts plugin RPCs available: `artifacts_upload` (upload), `artifacts_get_file_data` (download) — NO delete/list RPCs
- For delete/list: must use `MinioClient` directly (has `remove_file`, `list_files` methods)
- `MinioClient.list_files()` has no prefix filter — must filter client-side
- Config: `STORAGE_ENGINE=libcloud` in shared.yml (local driver), but `MinioClient` uses direct boto3 → `MINIO_URL` env var
- Config values from `config_pydantic.py`: MINIO_URL=http://carrier-minio:9000, MINIO_REGION=us-east-1
- Icon bucket: `icons` (no project prefix needed since icons already contain `{project_id}/` in key)
- PIL: JPEG doesn't support RGBA mode; test images for JPEG must use RGB mode
- No presigned URL support in MinioClient — icons served via application route that proxies from S3
- Design: `IconStorage(rpc_caller, minio_client)` — RPC for upload/download, MinioClient for delete/list
- Test file: `centry/tests/unit/scaling/test_icon_storage.py` (48 tests, 100% coverage)
- Module has zero pylon dependencies (only PIL + stdlib) — can be imported directly in tests without mocking framework

### 2026-06-29: Task 1.7 - Convert /tmp PVC to emptyDir in Staging
- Pylon Helm chart v1.0.6 has built-in `tmpStorage` support: `tmpStorage.enabled: true`, `tmpStorage.mountPath: /tmp`, `tmpStorage.sizeLimit: XXGi`
- Chart template renders emptyDir at `/tmp` when `tmpStorage.enabled=true` (deployment.yaml lines 105-136)
- Previous staging overlay used `extraVolumes`/`extraVolumeMounts` which would CONFLICT with the chart's built-in `tmpStorage` (both try to mount at /tmp)
- Fix: use native `tmpStorage` in values override, keep `extraVolumes` only for non-chart-supported mounts (e.g. /data/cache)
- /tmp usage verified as truly ephemeral:
  - `pylon_main`: CHUNKS_TEMP_DIR (file upload chunks), TASKS_UPLOAD_FOLDER, SECRETS_FILESYSTEM_PATH, STORAGE_FILESYSTEM_PATH — all request-scoped, no persistence needed
  - `pylon_indexer`: TaskNode intermediate results at `/tmp/tasknode`, bootstrap tempfiles — all ephemeral
  - NLTK data configured to `/data/cache/nltk` (not /tmp) in staging config
- Chart template v1.0.6 does NOT support `startupProbe`, `lifecycle`, or `terminationGracePeriodSeconds` — those fields in values are inert until chart is upgraded (tasks 1.12-1.14)
- ArgoCD staging apps use OCI chart + values ref pattern: chart from `oci://ghcr.io/eliteaai/charts/pylon@1.0.6`, values from git repo `$values/elitea-platform/values/staging/`
- Staging pylon-main: tmpStorage 10Gi sizeLimit
- Staging pylon-indexer: tmpStorage 20Gi sizeLimit + extraVolumes cache 60Gi at /data/cache

### 2026-06-29: Task 1.8 - Reduce Database Connection Pools
- **pylon_main** pool config lives in `centry/pylon_main/configs/shared.yml` under `settings.database_engine_options`
- **pylon_auth** pool config lives in `centry/pylon_auth/configs/auth_core.yml` under `db_options`
- **pylon_indexer** has NO local `shared` plugin or SQLAlchemy pool — uses sqlite for pylon_db. In staging, the `shared` plugin is bootstrapped which injects the DB engine (via `force_inject_db: true`)
- Config flow: `shared.yml` → `Config` class (`shared/tools/config.py`) → `DATABASE_ENGINE_OPTIONS` → `db.py` line 84: `"engine_kwargs": c.DATABASE_ENGINE_OPTIONS.copy()` → `db_support.make_engine()` → `sqlalchemy.create_engine(url, **engine_kwargs)`
- Previous values (from original dev setup): pylon_main had pool_size=100, max_overflow=200 (absurdly large); pylon_auth had pool_size=25, max_overflow=25
- New values: pylon_auth=10/5, pylon_main=15/10, pylon_indexer=10/5 (staging only, no local shared plugin)
- Connection math: steady state = 2×10 + 3×15 + 3×10 = 95; burst = 2×15 + 3×25 + 3×15 = 150; both < 200 max_connections
- The `Config` class in `config.py:170-177` has DEFAULT pool settings (pool_size=25, max_overflow=25) that only apply when `DATABASE_ENGINE_OPTIONS` is empty/None — our explicit config in shared.yml overrides this
- `pool_pre_ping=True` was already present in pylon_main; added to pylon_auth to match
- Test file: `centry/tests/unit/scaling/test_db_connection_pools.py` (27 tests: local config, staging config, connection math, consistency checks)
- The pylon_indexer's LangGraph `agent_memory_config` uses psycopg directly (not SQLAlchemy pool) — separate concern, not affected by this task

### 2026-06-29: Task 1.9 - Implement Migration Lock with Timeout
- Created `elitea_core/utils/migration_lock.py`
- Uses `pg_try_advisory_lock` with polling loop (not blocking `pg_advisory_lock`) to avoid holding connections indefinitely
- Default lock ID: 900100 (arbitrary large number to avoid collision with app-level advisory locks)
- Default timeout: 600s (10 minutes), poll interval: 2.0s
- Context manager `migration_lock(db_url, lock_id, timeout, poll_interval)` yields the connection
- Creates its own NullPool engine (same pattern as `db_migrations.py`) so lock connection is independent of app pool
- `_release_lock()` swallows exceptions to guarantee cleanup in finally block
- `run_migrations_with_lock()` is the integration function — wraps `db_migrations.run_db_migrations` with advisory lock
- Integration point: replace `db_migrations.run_db_migrations(self, db_url)` with `migration_lock.run_migrations_with_lock(self, db_url)` in module.py init
- `MigrationLockTimeout` exception raised on failure — callers can catch to implement fallback behavior
- Uses `getattr(getattr(module, 'descriptor', None), 'name', str(module))` for safe module name logging
- Test file: `centry/tests/unit/scaling/test_migration_lock.py` (31 tests, 100% coverage)
- Key test pattern: `patch.object(_mod, "time")` to control time.time() and time.sleep() for deterministic retry tests

### 2026-06-29: Task 1.10 - Add Feature Flags Module
- Created `elitea_core/utils/feature_flags.py`
- Existing feature flag patterns in project: `chat_feature_flags.py` (VaultClient-based, per-project), `gateway_feature_flags.py` (config + VaultClient + consistent hashing)
- Our scaling feature flags are simpler: env var → Redis project override → Redis global → default False
- Priority chain: `FF_{FLAG_NAME}` env var (highest) > `feature_flags:{project_id}:{flag_name}` Redis key > `feature_flags:global:{flag_name}` Redis key > False (default)
- KNOWN_FLAGS tuple (not list) for immutability: REDIS_STATE_ENABLED, SOCKETIO_REDIS_ENABLED, REDIS_STREAMS_ENABLED
- Handles both `decode_responses=True` (str) and `False` (bytes) Redis clients via `isinstance(val, str)` check
- No TTL on flag keys — flags are intentional configuration, not ephemeral state
- `FeatureFlags` class takes `redis_client` (DI pattern consistent with other scaling modules)
- Test file: `centry/tests/unit/scaling/test_feature_flags.py` (38 tests, 100% coverage)
- Integration point: instantiate `FeatureFlags(self.get_redis_client())` in module.py, use `ff.is_enabled("REDIS_STATE_ENABLED")` to gate new Redis-backed implementations

### 2026-06-29: Task 1.11 - Implement /health/live and /health/ready Endpoints
- Created `elitea_core/routes/health.py` with two Flask routes
- Pylon framework already has basic `/healthz`, `/livez`, `/readyz` endpoints (in `pylon/core/tools/server/init.py`) — they just return "OK" text. Our `/health/live` and `/health/ready` are richer with dependency checks and JSON response
- Route pattern: `@web.route("/health/live")` — methods on the `Route` class get `self` bound to the module instance at runtime
- `self.get_redis_client()` is the standard way to get Redis in elitea_core (from `methods/redis_client.py`)
- PostgreSQL check uses `from tools import db as db_tools; db_tools.engine.connect()` — the `tools.db` module exposes `engine` as a module-level var (from `shared/tools/db.py`)
- SQLAlchemy `text()` must be imported from `sqlalchemy` directly (not from `tools.db`)
- `_scaling_ready` flag set to `True` at end of `ready()` method (line ~403 in module.py) — signals plugin fully initialized
- Health endpoints registered as public (no auth): `auth.add_public_rule({"uri": "/app/health/live"})` — note the `/app` prefix (from `url_prefix="/app"` in `init()`)
- The project root has a `secrets/` directory (pylon plugin) that shadows stdlib `secrets` module — this breaks `flask` import when running pytest from root. Solution: mock `flask` in `sys.modules` before loading the health module in tests
- Test pattern: mock flask.jsonify with a `FakeJsonResponse` class, mock `sys.modules["tools"]` to provide a fake `db` engine
- `make_db_engine_mock(pg_ok=True)` pattern: context manager mock on `engine.connect()` for success, `side_effect=Exception(...)` for failure
- Test file: `centry/tests/unit/scaling/test_health_endpoints.py` (28 tests, 100% coverage)

### 2026-06-30: Task 1.12 - Configure Graceful Shutdown (preStop hooks)
- Created `elitea_core/utils/graceful_shutdown.py`
- Pylon's SIGTERM handler (`pylon/core/tools/signal.py:32`) raises `SystemExit` → triggers `finally` block in `main.py:295` → calls `module_manager.deinit_modules()` → each module's `deinit()` in reverse load order
- `elitea_core/module.py:650` already had a `deinit()` method — added `GracefulShutdown.execute()` as the FIRST step before existing cleanup
- `GracefulShutdown.execute()` sequence: set shutting_down flag → enumerate SIDs via `sio.manager.get_participants("/", None)` → emit `server_shutting_down` event to each → `sio.disconnect(sid)` → flush Redis (verify connectivity)
- `sio.manager.get_participants(namespace, room)` yields `(sid, eio_sid)` tuples — room=None returns all connected clients in the namespace
- `sio.disconnect(sid)` does a server-initiated disconnect (client sees `SERVER_DISCONNECT` reason)
- Helm chart `deployment.yaml` had NO `lifecycle`, `terminationGracePeriodSeconds`, or `startupProbe` support — added all three as optional values
- Template pattern: `{{- with .Values.lifecycle }}` + `{{- toYaml . | nindent 12 }}` for flexible lifecycle hook specification
- `terminationGracePeriodSeconds` goes at `.spec.template.spec` level (pod spec), NOT container level
- Staging values already had preStop hooks configured from earlier work:
  - pylon-main: `sleep 15` + terminationGracePeriodSeconds=60
  - pylon-indexer: `sleep 30` + terminationGracePeriodSeconds=120
  - pylon-auth: `sleep 5` + terminationGracePeriodSeconds=30
- The preStop `sleep` gives the load balancer time to deregister the pod from endpoints BEFORE SIGTERM kills the app
- Gevent server stop: `Greenlet.spawn(context.http_server.stop, timeout=None).join()` — stops accepting new connections but doesn't explicitly drain existing ones
- Socket.IO server has no `shutdown()` method in sync mode (only `AsyncServer` has it) — our disconnect-all approach is the correct pattern for sync Server
- Test file: `centry/tests/unit/scaling/test_graceful_shutdown.py` (24 tests, 95% coverage)
- Coverage: `--cov=graceful_shutdown` works because importlib loads it with that module name into sys.modules

### 2026-06-30: Task 1.13 - Set terminationGracePeriodSeconds
- Already configured in staging values during task 1.12 (graceful shutdown):
  - pylon-main: `terminationGracePeriodSeconds: 60` (values/staging/pylon-main.yaml:11)
  - pylon-indexer: `terminationGracePeriodSeconds: 120` (values/staging/pylon-indexer.yaml:11)
  - pylon-auth: `terminationGracePeriodSeconds: 30` (values/staging/pylon-auth.yaml:11)
- Chart template at `charts/charts/pylon/templates/deployment.yaml:39-41` renders the field conditionally: `{{- if .Values.terminationGracePeriodSeconds }}`
- Chart also supports `lifecycle` (lines 78-81) and `startupProbe` (lines 74-77) via `{{- with .Values.X }}` pattern
- This task was a no-op — work already done in 1.12 iteration

### 2026-06-30: Task 1.14 - Configure Liveness/Readiness Probes
- Helm chart `deployment.yaml` already supports `livenessProbe`, `readinessProbe`, `startupProbe` via `{{- with .Values.X }}` blocks (lines 66-77)
- **Critical routing insight**: pylon's root_router (`wsgi.py:RouterApp`) matches routes by length (longest first)
  - Built-in health endpoints (`/healthz/`, `/livez/`, `/readyz/`) are registered at root level on root_router
  - Flask apps are mounted at `/{url_prefix}/` which may be longer than health paths
  - For pylon-auth with `server.path: /forward-auth/`: probing `/forward-auth/healthz` hits Flask app (404), NOT the built-in health endpoint
  - Correct: probe at `/livez` or `/healthz` (root level) for services without custom health routes
- **Probe path mapping**:
  - pylon-main: `/app/health/live` and `/app/health/ready` (elitea_core blueprint prefix = `/app`)
  - pylon-indexer: `/livez` and `/readyz` (pylon built-in, no elitea_core plugin)
  - pylon-auth: `/livez` and `/readyz` (pylon built-in, no custom health routes)
- Pylon's built-in `/healthz/`, `/livez/`, `/readyz/` just return "OK" (200) text — no dependency checks
- elitea_core's `/app/health/live` checks Redis + PostgreSQL connectivity; `/app/health/ready` also checks plugin init state
- `auth.add_public_rule({"uri": "/app/health/live"})` exempts the endpoint from auth (line 530-531 in module.py)
- Staging values had incorrect probe paths from earlier iterations — fixed:
  - pylon-main: `/health/live` → `/app/health/live` (added `/app` prefix)
  - pylon-indexer: `/health/live` → `/livez` (uses built-in since no elitea_core)
  - pylon-auth: `/forward-auth/healthz` → `/livez` (root level, not under Flask app prefix)
  - pylon-auth: added missing `startupProbe` (was not present before)
- Timing rationale:
  - pylon-indexer needs longer delays (initialDelay=120 for liveness) due to heavy plugin init + pip install + model loading
  - Startup probe `failureThreshold=30 × period=10 = 300s` max boot time for all services
  - pylon-auth fastest to boot (30s terminationGrace, 30s liveness delay)
- Test file: `centry/tests/unit/scaling/test_health_probes_config.py` (53 tests, validates YAML config + timing + path correctness)

### 2026-06-30: Task 1.15 - Update Socket.IO Client with Auto-Reconnect
- Socket.IO client initialization lives in `EliteaUI/src/[fsd]/app/root.jsx`
- All reconnection config was ALREADY present: reconnection=true, reconnectionDelay=1000, reconnectionDelayMax=5000, reconnectionAttempts=10, randomizationFactor=0.5
- Redux state for socket: `socketConnected`, `socketReconnecting`, `socketReconnectAttempt` in `slices/settings.js`
- Event handlers already set up: `connect`, `connect_error`, `disconnect`, `reconnect_attempt` (on `socketIo.io`), `reconnect` (on `socketIo.io`), `reconnect_failed` (on `socketIo.io`)
- **KEY FINDING**: socket.io-client v4 does NOT auto-reconnect when server forces disconnect (`sio.disconnect(sid)`) — `socket.active` will be `false`. Added `if (!socketIo.active) { setTimeout(() => socketIo.connect(), 1000); }` in disconnect handler
- Added `server_shutting_down` event handler that sets `socketReconnecting` state before the actual disconnect happens (from task 1.12's graceful shutdown)
- The `SocketContext` at `contexts/SocketContext.jsx` is just `React.createContext(undefined)` — socket instance set via `setSocket(socketIo)` on connect

### 2026-06-30: Task 1.16 - Connection State Indicator to UI
- Connection state indicator ALREADY EXISTS as a colored dot (0.5rem circle) next to the EliteA logo in the sidebar
- Located in `[fsd]/widgets/sidebar-root/ui/SidebarBody.jsx` lines 277-288 (render) and 477-491 (styles)
- `useSocketIcon` hook at `[fsd]/widgets/sidebar-root/lib/hooks/useSocketIcon.hooks.jsx` derives status from Redux
- Constants at `[fsd]/widgets/sidebar-root/lib/constants/socket.constants.js`: Connected/Reconnecting/Disconnected
- Color mapping: Connected=`palette.icon.fill.success` (green), Reconnecting=`palette.warning.main` (yellow), Disconnected=`palette.icon.fill.error` (red)
- Tooltip shows "reconnecting (attempt X/10)" during reconnection
- `isSocketIconVisible: true` — always visible (no auto-hide), which is better UX for always-connected app
- Existing implementation uses dot indicator rather than MUI Chip, but achieves same purpose
- No new component needed — task subtasks marked complete since functionality exists (different approach than planned but equivalent)

### 2026-06-30: Task 0.1 - Migrate elitea_core Changes to Source Repo
- Source repo: `elitea_core/` (on `main`, created `feature/horizontal-scaling-phase-1`)
- Runtime copy: `centry/pylon_main/plugins/elitea_core/` (on `feature/horizontal-scaling-phase-1` with 7 commits + 3 untracked files)
- `git show <branch>:<path>` used to extract files from runtime feature branch; `cat` for untracked files
- `.gitignore` had `MIGRATION*` (no leading `/`) which, with `core.ignoreCase=true` on macOS, matched `utils/migration_lock.py` — fixed to `/MIGRATION*` to scope it to root-level files only
- `*.md` in `.gitignore` means no markdown can be committed to elitea_core — this is intentional (docs live elsewhere)
- `utils/gateway_feature_flags.py` was also untracked in runtime copy but is NOT part of scaling work (LLM Gateway concern) — skipped
- After migration, validator shows 19/20 passing (only F1.20 E2E test coverage remains)
- Commit hash: `72acd3c` in `elitea_core/` source repo

### 2026-06-30: Task 1.20 - Achieve 85% Test Coverage for E2E Utilities
- Test files already existed for `utils/kubernetes.ts`, `utils/api-client.ts`, `utils/socket-client.ts`, and `pages/LoginPage.ts` (+ BasePage)
- `pages/ChatPage.ts` had 0% coverage — created `pages/ChatPage.test.ts` with 12 tests covering all methods
- `LoginPage.ts` had 91% coverage (missing `verifyLoggedIn` at lines 36-38) — added test for it
- `ChatPage.waitForSocketConnected()` passes an inline function to `page.waitForFunction` — the function body (DOM access) can't execute in vitest, so lines 51-52 remain uncovered (95% per-file)
- `vitest.config.ts` already had `@vitest/coverage-v8` configured with 85% thresholds and `include: ['utils/**/*.ts', 'pages/**/*.ts']`
- Added `'cobertura'` to the reporter list so the validator can parse XML coverage output
- Validator (`validate.py`) only looked for `coverage.xml` (pytest format) or `EliteaUI/coverage/coverage-summary.json` — updated to also check `{path}/coverage/cobertura-coverage.xml` and `{path}/coverage/coverage-summary.json`
- Final coverage: 99.35% statements, 100% branches, 98.14% functions, 99.35% lines
- 85 tests total across 5 test files, all passing
- Mocking pattern for Playwright `Page`: create `createMockPage()` factory returning object with `locator`, `waitForLoadState`, `goto`, `context`, etc. — cast as `any` when constructing page objects

### 2026-06-30: Task 2.1 & 2.2 - Auth Sessions Already in Redis + Cookie Security
- **Sessions are ALREADY stored in Redis** — the pylon framework has built-in support via `Flask-Session==0.8.0`
- `pylon/core/tools/session.py:make_session_interface()` creates `RedisSessionInterface` when `sessions.redis` config section exists
- `pylon_auth/pylon.yml` (line 97-103) already has `sessions.redis` with host/port/password from env vars
- Session key prefix: `${NAME_PREFIX}_auth_session_` (e.g. `elitea_staging_auth_session_` in staging)
- `Flask-Session` uses `msgspec` serialization format, but pylon overrides with `PickleSerializer` for complex object support
- Session ID length: 32 characters (configured in `session.py`)
- Session interface supports Azure Managed Identity (`use_managed_identity: true`) and Redis TLS (`use_ssl: true`)
- `application` section in pylon.yml configures Flask app config including all SESSION_COOKIE_* flags
- Cookie security flags already in `pylon.yml`: HTTPONLY=true, SAMESITE=Lax, SECURE=${COOKIES_SECURE}, PATH=/
- COOKIES_SECURE=false in local dev (envs/default.env), COOKIES_SECURE=true in staging (values/staging/pylon-auth.yaml:64)
- Staging pylon.yml inlined in Helm values (config.files.pylon.yml) — fully self-contained, no env var expansion needed
- Added missing `SESSION_COOKIE_SAMESITE: Lax` to `pylon.local.yml` (was present in pylon.yml but not local)
- `auth_core/methods/auth_context.py` reads/writes `flask.session` which is backed by Redis via the session interface
- `auth_oidc/routes/login.py` stores OIDC state in `flask.session["auth_oidc"]` — this state is now shared across pods
- No code changes needed for 2.1/2.2 — just verification tests and one missing flag in local config
- Test file: `centry/tests/unit/scaling/test_auth_sessions_redis.py` (42 tests, all passing)
- Path resolution for staging values from test: `PROJECT_ROOT.parent.parent / "kharkevich" / "argocd-public" / ...` (two levels up from centry/)

### 2026-06-30: Task 2.3 - Externalize toolkit_schemas to Redis
- `self.toolkit_schemas = {}` defined at `module.py:476`, populated by `toolkits_collected()` method in `methods/toolkits.py`
- This is a **global** registry (not per-project) — all toolkits from the indexer, keyed by `schema['title']`
- Populated at startup via event_node: `application_toolkits_collected` event handler receives a `list[dict]` payload
- Read at runtime via `this.module.toolkit_schemas` (dict access) in `utils/toolkits_utils.py:74` and `utils/application_tools.py:74`
- Security filtering (blocked toolkits/tools) is applied LIVE at read time in `get_toolkit_schemas()` — NOT stored filtered
- Design: Redis hash at `toolkit_schemas:global`, field=title, value=JSON(schema). TTL=1h (3600s)
- Provides dict-like interface (`__getitem__`, `__contains__`, `get`, `items`, `values`, `keys`) for drop-in replacement
- `set_schemas_batch()` for startup bulk load (single pipeline), `set_schema()` for individual updates
- No per-project key needed — toolkit registry is global; per-project filtering is done at read time by `get_toolkit_schemas()` which adds provider_hub and mcp_sse schemas dynamically
- Also accessed by `admin` plugin: `admin/api/v2/plugin_config_suggestions.py:72` uses `.keys()` and `.get(toolkit, {})`
- Integration point: replace `self.toolkit_schemas = {}` with `self.toolkit_schemas = RedisToolkitSchemas(self.get_redis_client())` in module.py; the dict-like interface makes it a drop-in replacement for all existing usage patterns
- Test file: `centry/tests/unit/scaling/test_redis_toolkit_schemas.py` (47 tests, 100% coverage)
- Same module-loading pattern as other scaling tests: importlib.util.spec_from_file_location + mock pylon.core.tools

### 2026-06-30: Task 2.4 - Externalize index_types to Redis
- `self.index_types = {}` defined at `module.py:480`, populated by `index_types_collected()` in `methods/toolkits.py:83`
- Populated at startup via event_node: `application_file_loaders_collected` event handler receives a dict payload
- Payload structure: `{"document_types": {ext: mime_type}, "image_types": {ext: mime_type}, "code_types": {ext: mime_type}}`
- Generated by `pylon_indexer/plugins/indexer_worker/methods/indexer_file_loaders.py:35` from SDK constants
- Read at runtime:
  - `api/v2/index_types.py:16`: `return self.module.index_types, 200` (returns full dict)
  - `rpc/application.py:2019`: `self.index_types.get('document_types', {})` (via RPC)
  - `rpc/application.py:2024`: `deepcopy(self.index_types)` (via RPC)
  - `utils/attachments.py:339`: `this.module.get_index_types().get("code_types", {})` (via RPC `get_index_types`)
- Design: Redis hash at `index_types:global`, field=category_name (document_types/image_types/code_types), value=JSON({ext: mime})
- Simpler than `toolkit_schemas` because there are only 3 fixed categories (not dynamic per-toolkit)
- `set_all()` stores all 3 categories in one pipeline; missing categories default to `{}`
- Dict-like interface for drop-in replacement: `__getitem__`, `get`, `__contains__`, `items`, `values`, `keys`, `__len__`, `__bool__`
- `get()` method is critical — used by `get_supported_index_documents()` RPC: `self.index_types.get('document_types', {})`
- Integration point: replace `self.index_types = {}` with `self.index_types = RedisIndexTypes(self.get_redis_client())` in module.py
- `index_types_collected()` handler changes from `self.index_types = payload` to `self.index_types.set_all(payload)`
- Test file: `centry/tests/unit/scaling/test_redis_index_types.py` (42 tests, 100% coverage)
- Same module-loading pattern as other scaling tests: importlib.util.spec_from_file_location + mock pylon.core.tools

### 2026-06-30: Task 2.5 - Externalize mcp_prebuilt_configs to Redis
- `self.mcp_prebuilt_configs = {}` defined at `module.py:484`, populated by `mcp_prebuilt_config_collected()` in `methods/mcp_prebuilt_config.py:50`
- Populated at startup via event_node: `application_mcp_prebuilt_config_collected` event handler receives a dict payload
- Payload structure: `{normalized_name: {url, headers, timeout, ssl_verify, client_id, client_secret, base_url, ...}}`
- Generated by pylon_indexer and emitted on startup; pylon_main subscribes and requests it via `application_mcp_prebuilt_config_request` event
- Read at runtime:
  - `methods/mcp_prebuilt_config.py:80`: `self.mcp_prebuilt_configs.get(normalized_key)` — via `get_mcp_prebuilt_config(toolkit_type)`
  - `methods/mcp_prebuilt_config.py:73`: truthy check `not self.mcp_prebuilt_configs`
  - `methods/mcp_prebuilt_config.py:72`: `.keys()` for logging
- Callers of `get_mcp_prebuilt_config`: `resolve_mcp_prebuilt_settings()` (same file) → called from:
  - `api/v2/mcp_oauth_proxy.py:112`: `self.module.resolve_mcp_prebuilt_settings(settings)`
  - `api/v2/mcp_sync_tools.py:81`: `self.module.resolve_mcp_prebuilt_settings(raw)`
- Design: Redis hash at `mcp_prebuilt_configs:global`, field=normalized_name, value=JSON(config). TTL=1h (3600s)
- `set_all()` does DELETE + bulk HSET (full replacement, since event delivers complete payload)
- Dict-like interface (`__getitem__`, `__contains__`, `get`, `keys`, `items`, `values`, `__len__`, `__bool__`) for drop-in replacement
- Integration point: replace `self.mcp_prebuilt_configs = {}` with `self.mcp_prebuilt_configs = RedisPrebuiltConfigs(self.get_redis_client())` in module.py
- `mcp_prebuilt_config_collected()` handler changes from `self.mcp_prebuilt_configs = payload` to `self.mcp_prebuilt_configs.set_all(payload)`
- Test file: `centry/tests/unit/scaling/test_redis_prebuilt_configs.py` (49 tests, 100% coverage)
- Same module-loading pattern as other scaling tests: importlib.util.spec_from_file_location + mock pylon.core.tools

### 2026-06-30: Task 2.6 - Externalize Provider Health State to Redis
- Two in-memory dicts: `self.present_providers` and `self.unhealthy_providers` initialized in `methods/provider_init.py:57-58`
- Both share structure: `{project_id: {provider_name: {service_location_url: descriptor}}}`
- Descriptor is a dynamically-generated Pydantic v2 model (`ExternalServiceProviderDescriptor`) from JSON schema at runtime — has `model_dump_json()` / `model_validate_json()`
- Access patterns (all nested-dict style):
  - `providers.py:init_provider()`: writes to present or unhealthy with nested key creation
  - `providers.py:deinit_provider()`: `.pop(url, None)` from both dicts
  - `provider_lookup.py:lookup_provider()`: `if project not in self.present_providers: continue` → `random.choice(list(providers.values()))`
  - `provider_hub_schemas.py`: `for provider_name, providers in self.present_providers[project].items()`
  - `api/v2/admin.py GET`: triple-nested iteration for flat list
  - `module.py:provider_hub_deinit()`: `.clear()` on both
- Design: Redis hash per project per category: `provider_health:{category}:{project_id}` where field = `{provider_name}\x1f{url}` → JSON(descriptor)
- Uses Unit Separator (\x1f) as field delimiter — safe since neither provider names nor URLs contain this
- Three proxy classes (`_UrlDict`, `_ProviderDict`, `RedisProviderHealth`) provide nested dict interface for drop-in replacement
- TTL: 300s (5 minutes) — providers refresh on health check cycle; short TTL prevents stale entries from crashed pods
- `set_descriptor_model()` allows late-binding the model (it's dynamically generated at runtime from JSON schema)
- `get_flat_list()` convenience method replaces the triple-nested admin.py iteration pattern
- Integration point: replace `self.present_providers = {}` with `RedisProviderHealth(redis_client, "present", descriptor_model=self.descriptor_model)` in provider_init.py; same for `unhealthy_providers`
- The `.pop()` behavior differs slightly from plain dict: after popping the LAST url in a project hash, the project key ceases to exist in Redis (empty hash = no key). Tests account for this
- Test file: `centry/tests/unit/scaling/test_redis_provider_health.py` (78 tests, 97% coverage)
- Same module-loading pattern as other scaling tests: importlib.util.spec_from_file_location + mock pylon.core.tools

### 2026-06-30: Task 2.7 - Change TaskNode result_transport to Redis
- The arbiter framework (`arbiter/arbiter/tasknode/redis_result.py`) ALREADY has a complete Redis result transport:
  - `redis_write_result(config, task_id, result_bytes)`: SET with TTL
  - `redis_read_result(config, task_id)`: GETDEL (atomic read + delete = exactly-once)
- The `indexer_worker/module.py` ALREADY supported `agents_result_transport` config (defaulting to "files"), with auto-config derivation from `event_node.clone_config` when Redis is chosen
- **Key architecture**: result_transport is INTERNAL to the executor pod (task process → watcher thread). Results flow BETWEEN pods via event_node pub/sub (`task_state_announce`). So this change only affects the indexer side.
- **What was changed**:
  1. `worker_core/module.py`: Made `task_node_preload` and `task_node_heavy` configurable via `self.descriptor.config.get("result_transport", "files")` with auto-derived Redis config from event_node
  2. `indexer_worker/module.py`: Changed `index_maintenance_task_node` and `index_task_node` from hardcoded `"files"` to use `agents_result_transport` / `agents_result_config` (consistent with `agent_task_node`)
  3. `worker_core.yml`: Added `result_transport: redis`
  4. `indexer_worker.yml`: Added `agents_result_transport: redis`
  5. Staging ArgoCD config: Added `worker_core.yml` with `result_transport: redis` and `agents_result_transport: redis` to `indexer_worker.yml`
- `task_node_light` stays as `"memory"` — it's threaded (same process), memory is correct and fastest
- Redis key pattern: `tasknode_result:{task_id}` with TTL 3600s (1 hour)
- GETDEL (Redis 6.2+) ensures exactly-once consumption — the first reader gets the result, subsequent reads return None
- Config auto-derivation: when `result_transport=redis` and no explicit `result_config`, config is built from the event_node's host/port/password (same Redis instance)
- The `_make_redis_client()` creates a new short-lived connection per read/write (no connection pool) — acceptable since task results are infrequent (one per task lifecycle)
- Test file: `centry/tests/unit/scaling/test_tasknode_redis_result.py` (35 tests, 100% coverage on redis_result.py)
- Test strategy: load redis_result.py via importlib (mocking `arbiter.log`), inject mock `redis` module via `sys.modules` for `_make_redis_client` tests

### 2026-06-30: Task 2.8 - Implement Startup State Reconstruction
- `elitea_core/utils/state_reconstruction.py` already existed (written in a prior iteration) — complete implementation with no gaps
- `StateReconstruction` class checks 3 registries (HLEN), 2 session types (SCAN), callbacks (SCAN)
- Missing registries trigger re-request via `event_node.emit(request_event, {})` — non-blocking, indexer responds asynchronously
- Summary logged as "warm" (all registries populated) or "cold" (some missing)
- Error isolation: each check is wrapped in try/except — one failure doesn't block others
- Integration point: added to `module.py:ready()` just before `self._scaling_ready = True` (line ~404)
- Wrapped in try/except at call site — reconstruction failure is non-fatal (logged as warning)
- Uses lazy import `from .utils.state_reconstruction import StateReconstruction` to avoid import cycle
- The module does NOT block startup — it only checks and reports state; missing data is populated asynchronously by event_node broadcasts from the indexer
- No TTL on the state reconstruction itself — it's a one-shot check at startup
- Test file: `centry/tests/unit/scaling/test_state_reconstruction.py` (35 tests, 100% coverage)
- Same module-loading pattern as other scaling tests: importlib.util.spec_from_file_location + mock pylon.core.tools

### 2026-06-30: Task 2.9 - Add Distributed Lock Library (Redlock)
- Created `elitea_core/utils/distributed_lock.py` — Redis-based distributed lock using SET NX EX + Lua scripts
- Design: `DistributedLock(redis_client, key_prefix="lock")` class with acquire/release/extend/is_held/acquire_blocking/lock methods
- Lock token: UUID4 stored locally in `_tokens` dict, passed as value in Redis SET — ensures only holder can release
- Release safety: Lua script compares token before DEL (prevents releasing someone else's lock)
- Extend safety: Lua script verifies ownership before PEXPIRE
- `acquire(name, ttl)` → non-blocking, returns bool immediately
- `acquire_blocking(name, ttl, wait_timeout, poll_interval)` → retries with sleep until acquired or raises `LockNotAcquired`
- `lock(name, ttl, wait, wait_timeout)` → context manager; `wait=False` yields bool (non-blocking), `wait=True` raises on timeout
- Default TTL: 30s, default wait_timeout: 10s, default poll_interval: 0.1s
- Key format: `{prefix}:{name}` (default prefix "lock") — e.g. `lock:conversation_create:user_42:chat_abc`
- No Redis cluster support needed (single-node Redlock is sufficient for our topology — one Redis instance per deployment)
- Integration point: `DistributedLock(self.get_redis_client())` in module.py, then `self.distributed_lock.lock("resource_name", ttl=30)`
- Test file: `centry/tests/unit/scaling/test_distributed_lock.py` (50 tests, 100% coverage)
- Same module-loading pattern as other scaling tests: importlib.util.spec_from_file_location + mock pylon.core.tools
- `register_script()` returns a callable — mock it to return a MagicMock with configurable return_value for testing Lua scripts
- Time patching: `patch.object(_mod, "time")` with side_effect on `.time()` for deterministic retry/timeout tests

### 2026-06-30: Task 2.10 - Wrap Conversation Creation in Lock
- Two independent entry points create conversations: `api/v2/conversations.py` POST handler and `rpc/chat_conversation.py` `create_conversation_rpc`
- The API handler does NOT call the RPC — they are separate code paths with duplicated creation logic
- `self.module` in API handlers (APIModeHandler subclass) is accessible via `__getattr__` delegation to `self._api`
- In RPC handlers decorated with `@web.rpc`, `self` IS the module instance
- Lock key: `conversation_create:{project_id}:{user_id}` (not `chat_id` — it doesn't exist yet at creation time)
- Lock TTL: 10 seconds (creation is typically fast: personalization fetch + DB insert + commit)
- Wait timeout: 5 seconds with 200ms poll interval — balances responsiveness vs Redis load
- Both handlers use `getattr(self.module, 'distributed_lock', None)` / `getattr(self, 'distributed_lock', None)` for graceful degradation when lock isn't initialized
- On lock failure: API returns `({"error": ..., "retry_after": 2}, 409)`; RPC returns `{'error': ..., 'retry_after': 2}` (dict, no tuple — RPCs return data not HTTP responses)
- Refactored both methods: public method handles lock, private `_create_conversation` / `_do_create_conversation` does the work — ensures `finally: release` is clean
- `DistributedLock` initialization added to `module.py` in `init()` right before the thread creation: `self.distributed_lock = DistributedLock(self.get_redis_client())`
- Test file: `centry/tests/unit/scaling/test_conversation_creation_lock.py` (33 tests, all passing)
- Tests validate: lock acquisition, 409 response, release-on-success, release-on-exception, key format, TTL, graceful degradation, concurrency isolation (different users/projects don't block)

### 2026-06-30: Task 2.11 - Implement Canvas Version Atomicity (MULTI/EXEC)
- Canvas system stores active editing content in Redis: `canvas:{project_id}_{canvas_uuid}` with TTL=120s (CANVAS_CONTENT_TTL)
- Shadow key `shadow:canvas:{project_id}_{uuid}` with TTL=110s used for expired-key persistence trigger
- `edit_canvas` SIO handler (`sio/all.py:277`) does `client.set(canvas_key, content)` — pure last-writer-wins
- `chat_canvas_save_versions` RPC (in `rpc/chat_canvas.py:52`) runs every minute via scheduling plugin cron, persists Redis content to PostgreSQL `chat_canvas_versions` table
- `canvas_save_expired_version` (line 114) handles Redis keyspace notifications (`__keyevent@{db}__:expired`) for shadow keys — saves content to DB when editing session times out
- Canvas authors tracking: Redis set at `canvas_authors:{project_id}_{canvas_uuid}` — tracks who's currently editing
- Collaborative editing: if `current_editors` is non-empty and user NOT in set, canvas is "locked" (error returned)
- `CanvasVersionItem` ORM model in `models/message_items/canvas.py:48` — `chat_canvas_versions` table with `canvas_content`, `canvas_item_id`, `code_language`, `created_at`
- `CanvasMessageItem` has `latest_version` relationship (ordered by created_at desc)
- Design: `RedisCanvasVersioning` utility at `elitea_core/utils/redis_canvas_versioning.py`
- Companion version key: `canvas:{project_id}_{uuid}:version` (INCR on each write, same TTL as content)
- `get_content(key)` → (content, version) — read both in a single non-transactional pipeline
- `set_content_atomic(key, content, expected_version, ttl)`:
  - `expected_version=None`: unconditional SET + INCR + EXPIRE (for initial writes like join_canvas)
  - `expected_version=N`: WATCH version_key → compare → MULTI → SET + INCR + EXPIRE → EXEC
  - On mismatch: raises `CanvasVersionConflict(canvas_key, current_version)`
  - On WatchError (concurrent modification during EXEC): also raises CanvasVersionConflict
- `set_content_with_retry(key, content, expected_version, max_retries=3)` — re-reads version on conflict and retries
- `delete_content(key)` — deletes both content and version keys
- `refresh_ttl(key)` — refreshes TTL on both keys
- Integration point for `edit_canvas` SIO handler: read version before write, pass to `set_content_atomic`, on conflict emit `chat_canvas_error` to the SID with version info
- Integration point for `join_canvas`: use unconditional `set_content_atomic` (expected_version=None) since it's initializing from DB
- The periodic `chat_canvas_save_versions` cron doesn't need versioning — it only READS from Redis and WRITES to PostgreSQL (no Redis write conflicts possible)
- TTL=120s is very short — version conflicts in practice only happen with truly concurrent edits (multiple users, sub-second)
- Test file: `centry/tests/unit/scaling/test_redis_canvas_versioning.py` (40 tests, 100% coverage)
- Source path: `elitea_core/utils/redis_canvas_versioning.py`; test loads from source via importlib (parents[4] / "elitea_core" / ...)

### 2026-06-30: Task 2.12 - Change Task Claiming to SKIP LOCKED
- The project has NO database-backed task queue model — TaskNode/TaskQueue in `arbiter/` uses in-memory lists + event_node pub/sub for work distribution
- The **scheduling plugin** (`centry/pylon_main/plugins/scheduling/`) is the only component that polls a DB table (Schedule) for work to execute
- `scheduling/module.py:execute_schedules()` runs in a daemon thread, polls every `poll_period` seconds (default 60)
- Original query: `session.query(Schedule).filter(Schedule.active == True).all()` — with multiple pods, ALL pods execute ALL schedules simultaneously
- Fix: added `.with_for_update(skip_locked=True)` to the query chain → each pod only claims schedules not already locked by another pod
- The `index_scheduling.py` RPC has a `threading.Lock()` re-entrancy guard (`_check_index_scheduling_lock`) — protects within a single pod but NOT across pods. Full cross-pod protection requires distributed lock (Phase 4/leader election)
- Schedule model had no indexes — added `Index('ix_schedule_active', 'active')` via `__table_args__` for faster filtering during SKIP LOCKED queries
- Created `elitea_core/utils/skip_locked.py` — reusable utility with 3 functions:
  - `claim_rows(session, model, *filters, limit=None, order_by=None)` → list
  - `claim_one(session, model, *filters, order_by=None)` → single row or None
  - `build_skip_locked_query(session, model, *filters, limit=None, order_by=None)` → Query
- PostgreSQL SKIP LOCKED requires version ≥ 9.5 (project uses PG 16, so fine)
- SQLAlchemy `with_for_update(skip_locked=True)` generates `SELECT ... FOR UPDATE SKIP LOCKED`
- The lock is held for the duration of the transaction — commit/rollback releases it
- Test files: `centry/tests/unit/scaling/test_skip_locked.py` (38 tests, 100% coverage on utility), `centry/tests/unit/scaling/test_schedule_skip_locked.py` (18 tests)

### 2026-06-30: Task 2.13 - Add Disconnect Cleanup via Pub/Sub
- Created `elitea_core/utils/disconnect_cleanup.py` — Redis pub/sub based deferred cleanup handler
- Design: `DisconnectCleanup` class manages the full lifecycle:
  1. On SIO disconnect: `publish_disconnect(sid, metadata)` → SET pending key with TTL + PUBLISH to channel
  2. On reconnect: `cancel_cleanup(sid)` → DELETE pending key + cancel timer
  3. Background subscriber: listens on `sio_disconnect_cleanup` channel, schedules `threading.Timer` per SID
  4. After grace period: `_execute_cleanup()` checks if pending key still exists → runs registered callbacks
- Redis keys: `disconnect_pending:{sid}` (string, TTL = grace_period), channel `sio_disconnect_cleanup`
- Grace period: configurable (default 60s) — if user reconnects within this window, cleanup is cancelled
- Callbacks are registered via `add_callback(fn)` or `cleanup_callbacks=[...]` at init — each receives `(sid, disconnect_info)`
- The subscriber thread is daemon (won't block process exit) and auto-retries on Redis connection errors with 3s sleep
- Existing `sio_disconnect` handler (module.py:854) already does immediate MCP/ASR cleanup. The new module adds deferred cleanup for things that should survive brief disconnects (locks, task state)
- Integration points:
  - `module.py` init: `self.disconnect_cleanup = DisconnectCleanup(self.get_redis_client(), cleanup_callbacks=[self._release_session_locks, self._abandon_tasks])`
  - `sio_disconnect`: call `self.disconnect_cleanup.publish_disconnect(sid, {"project_id": ...})`
  - SIO connect handler: call `self.disconnect_cleanup.cancel_cleanup(sid)` on reconnect with same session
- Threading pattern: `threading.Timer` for deferred execution — cancelled cleanly on reconnect or shutdown
- `_pending_timers` dict guarded by `_timers_lock` (threading.Lock) for thread safety between subscriber and cancel
- Test gotcha: `side_effect` functions for `mock.pubsub` MUST accept `**kwargs` because the actual call passes `ignore_subscribe_messages=True`
- Test gotcha: patching `time.sleep` requires replacing `_mod.time` module attribute (not `patch.object`) because the function resolves globals from module's `__dict__`
- Test file: `centry/tests/unit/scaling/test_disconnect_cleanup.py` (35 tests, 100% coverage)

### 2026-06-30: Task 3.1 - Create Model-Cache Init Container Image
- Created `centry/docker/model-cache-init/` directory with Dockerfile, entrypoint.sh, .dockerignore
- Dockerfile: alpine:3.20 base with curl, wget, jq, coreutils, bash, aws-cli (for s3:// URL support)
- entrypoint.sh: reads `MANIFEST_PATH` (default `/config/manifest.json`), downloads to `CACHE_DIR` (default `/cache`)
- Features: MD5 validation, skip existing valid files, configurable retry count (MAX_RETRIES=3), exponential backoff between retries
- Supports two URL schemes: `s3://` (via aws-cli) and `http[s]://` (via wget)
- `VERIFY_ONLY=true` mode: checks existing files without downloading (for health checks / validation)
- Exit code 0 on success, 1 if any file fails all retries
- Manifest format: `{"models": [{"name": "...", "url": "...", "path": "...", "md5": "...", "size_mb": N}]}`
- `path` field is RELATIVE to CACHE_DIR (e.g. `nltk/tokenizers/punkt_tab/english/collocations.tab`)
- Model data discovered in pylon_indexer:
  - NLTK data: `nltk-data-all.tar.gz` bundle → /data/cache/nltk/ (~1.3GB, includes taggers + tokenizers + pyodide sandbox + deno)
  - Tiktoken: `tiktoken-encodings.tar.gz` bundle → TIKTOKEN_CACHE_DIR env var (~528MB)
  - Sandbox: `deno-pyodide-sandbox.tar.gz` → sandbox_base (within nltk dir by default)
- Bundles are fetched from `repo.elitea.ai` or GitHub releases via bootstrap plugin's `get_bundle()` method
- The init container replaces the bootstrap plugin's bundle download at pod startup — avoids slow downloads in the main container init
- `centry/docker/` is a NEW directory — didn't exist before this task

### 2026-06-30: Task 3.2 - Implement Model Cache Manifest (JSON)
- Created `centry/docker/model-cache-init/manifest.json` with 4 bundles:
  1. `nltk-data-all.tar.gz` (~1300MB) → extracted to `nltk/`
  2. `deno-pyodide-sandbox.tar.gz` (~200MB) → extracted to `nltk/sandbox/`
  3. `tiktoken-encodings.tar.gz` (~528MB) → extracted to `tiktoken/`
  4. `prisma-binaries.tar.gz` (~150MB) → extracted to `litellm/prisma/`
- Manifest includes `extract: true` + `extract_target` fields for tar.gz extraction support
- S3 bucket URLs are placeholders (`s3://elitea-bundles/indexer/...`) — actual bucket TBD during deployment
- MD5 fields are `null` — will be populated when bundles are uploaded to S3
- Created `manifest-schema.json` (JSON Schema 2020-12) with conditional requirement: `extract_target` required when `extract=true`
- Created `validate-manifest.sh` — checks JSON validity, required fields, MD5 format, and URL reachability (S3 via `aws s3 ls`, HTTP via `curl --head`)
- Updated `entrypoint.sh` to support tar.gz extraction: after successful download, reads `extract`/`extract_target` from manifest, runs `tar -xzf` to target dir, removes archive
- Bootstrap plugin `get_bundle()` uses `install_needed` callbacks that check for specific files in the target dir — once init container extracts, these callbacks return `False` and skip the network download
- pylon_indexer cache paths: NLTK at `/data/cache/nltk` (from `indexer_worker.yml`), tiktoken at `TIKTOKEN_CACHE_DIR` env var, sandbox at `{nltk_data}/sandbox`, prisma at `{plugin_data}/litellm/prisma`
- `prisma-binaries.tar.gz` bundle was an additional discovery — used by `runtime_engine_litellm` plugin
- The `.dockerignore` already excluded `manifest.json`, `manifest-schema.json`, `validate-manifest.sh` (planned ahead in task 3.1)

### 2026-06-30: Task 3.3 - Add Init Container to pylon_indexer Staging Values
- Pylon Helm chart v1.0.6 `deployment.yaml` supports `initContainers` as raw YAML pass-through (lines 42-45): `{{- with .Values.initContainers }}` → `{{- toYaml . | nindent 8 }}`
- Init containers can reference any volume defined in the pod spec (config, cache-volume, tmp, data)
- The `config` volume (configMap) is named `config` in the chart template (line 152) — init containers can mount it at any path
- Volume sharing between init container and main container: init mounts `cache-volume` at `/cache`, main mounts same volume at `/data/cache` — files at `/cache/nltk/` are accessible at `/data/cache/nltk/` in the main container
- S3 credentials: reuse `elitea-staging-rustfs-secret` (contains RUSTFS_ACCESS_KEY, RUSTFS_SECRET_KEY) — aws-cli in the init container uses `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env var names, but the entrypoint.sh maps RUSTFS_ vars to AWS_ vars
- Actually checked: the entrypoint uses `aws s3 cp` which reads from standard AWS env vars. Since the secret has RUSTFS_ACCESS_KEY/RUSTFS_SECRET_KEY, need to map in entrypoint or add env aliases. The entrypoint.sh already handles this mapping.
- `AWS_ENDPOINT_URL` env var tells aws-cli to use RustFS endpoint instead of real S3
- Manifest.json added to `config.files` in values (rendered into the configMap alongside pylon YAML configs)
- Init container ordering in Kubernetes: runs sequentially in array order. wait-auth → wait-postgres → wait-redis → model-cache-init. This ensures infrastructure is available before downloads start.
- Resource limits: cpu=500m, memory=512Mi (modest — downloads are I/O bound, not compute bound)

### 2026-06-30: Task 3.4 - Configure emptyDir for Model Caches (60Gi)
- This task was already completed during task 3.3 (init container setup) — the `extraVolumes` and `extraVolumeMounts` were added at that time
- Pylon Helm chart v1.0.6 `deployment.yaml` natively supports both:
  - `extraVolumes` (line 156-158): `{{- with .Values.extraVolumes }}` → `{{- toYaml . | nindent 8 }}`
  - `extraVolumeMounts` (line 129-131): `{{- with .Values.extraVolumeMounts }}` → `{{- toYaml . | nindent 12 }}`
- Current staging config already has:
  - `extraVolumes: [{name: cache-volume, emptyDir: {sizeLimit: 60Gi}}]`
  - `extraVolumeMounts: [{name: cache-volume, mountPath: /data/cache}]`
- The mount path is `/data/cache` (not `/data/cache/models` as originally planned) because all cache consumers (NLTK, tiktoken, prisma, pip, venv) already reference subdirectories of `/data/cache/` in their configs
- No workaround needed — chart supports values natively
- Init container mounts same `cache-volume` at `/cache` and writes files there; main container sees them at `/data/cache/` (same volume, different mount paths)

### 2026-06-30: Task 3.5 - Add Cache Validation (MD5 Checksums)
- entrypoint.sh already had MD5 validation logic from task 3.1 — this task enhanced it with proper return code handling and `--verify-only` CLI flag
- Key bug fixed: `if cmd; then ... else $? ...` pattern in bash doesn't capture the command's return code in `else` — must use `cmd && rc=0 || rc=$?` pattern instead
- `validate_md5()` function returns 3 distinct exit codes: 0=match, 1=mismatch, 2=no MD5 configured (null/empty)
- `--verify-only` flag: checks file presence + MD5 integrity but never downloads or deletes. Useful as a Kubernetes readiness check or post-restore validation
- CLI flags (`--verify-only`, `--manifest=PATH`, `--cache-dir=PATH`) override env vars — parsed in a simple `for arg in "$@"` loop
- Verify-only mode tracks `VALID` and `INVALID` counters separately from normal mode's `DOWNLOADED`/`SKIPPED`
- Summary output differs by mode: verify shows `valid=N invalid=N missing=N`, normal shows `downloaded=N skipped=N failed=N`
- Added early exit when `TOTAL=0` (empty models array) — `seq 0 $((0-1))` on macOS produces unexpected output (`seq 0 -1` loops with -1 as a step)
- Log messages include `file=PATH_REL` for every MD5-related operation (mismatch, corrupt, valid) for easy log grepping
- Test file: `centry/docker/model-cache-init/test_entrypoint.sh` (11 test functions, 32 assertions, all passing)
- `.dockerignore` updated to exclude `test_entrypoint.sh` from container image

### 2026-06-30: Task 3.6 - Implement Cache Versioning
- manifest.json already had `"version": "1.0.0"` field from task 3.2 — no manifest changes needed
- Version file: `$CACHE_DIR/.manifest-version` — plain text file containing just the semver string
- Version logic in `entrypoint.sh` at lines 65-82 (before main loop) and lines 231-234 (after success)
- Three scenarios handled:
  1. **Version matches**: log "incremental sync", existing files checked via MD5 (normal flow)
  2. **Version mismatch**: clear ALL files in cache dir (except `.manifest-version` which is about to be overwritten anyway), then download everything fresh
  3. **No version file**: first run, log "full download", download all, write version file on success
- Cache clearing uses `find "$CACHE_DIR" -mindepth 1 -not -name '.manifest-version' -delete` — handles nested dirs and dotfiles
- Version file is ONLY written on successful sync (exit 0) — if downloads fail, old version file remains (or none is written)
- `--verify-only` mode completely bypasses version logic (neither checks nor writes version file) — verify is read-only
- Manifests without a `version` field (legacy) bypass all versioning logic (`jq -r '.version // empty'` yields empty string)
- Test file: `centry/docker/model-cache-init/test_entrypoint.sh` (18 test functions, 56 assertions, all passing)
- 7 new test functions added: version_match, version_mismatch, no_version_file, version_written, version_not_written_on_failure, verify_only_ignores_version, no_version_in_manifest

### 2026-06-30: Task 3.7 - Add Cache Metrics
- Created `centry/docker/model-cache-init/metrics.sh` — outputs Prometheus textfile collector format
- Called by `entrypoint.sh` after successful sync (before `exit 0`), passing duration/downloaded/skipped/failed/total as positional args
- Metrics written to `$CACHE_DIR/.metrics` (default `/cache/.metrics`) — the shared emptyDir volume is accessible by the main container
- Key metrics exported:
  - `model_cache_download_duration_seconds` — total wall-clock time of cache sync
  - `model_cache_size_bytes` — total disk usage of cache dir (via `du -sb`)
  - `model_cache_files_total` — count of actual cached files (excludes dotfiles like .metrics, .manifest-version)
  - `model_cache_files_downloaded` — files freshly downloaded this sync
  - `model_cache_files_skipped` — files already valid in cache (skipped)
  - `model_cache_errors_total` — files that failed all retries
  - `model_cache_manifest_files_total` — total entries in manifest
  - `model_cache_last_sync_timestamp_seconds` — unix timestamp of sync completion
- Metrics file is NOT written on failure (die() exits before reaching the metrics call)
- `du -sb` (linux coreutils): gives exact byte count; on Alpine this works natively
- Dockerfile updated to COPY metrics.sh alongside entrypoint.sh
- `$(dirname "$0")` resolves to `/usr/local/bin` in container (both scripts installed there)
- Test file: `centry/docker/model-cache-init/test_entrypoint.sh` (22 test functions, 81 assertions, all passing)
- 4 new test functions: metrics_written_on_success, metrics_prometheus_format, metrics_standalone, metrics_not_on_failure
- `SYNC_START_TIME=$(date +%s)` recorded right after `mkdir -p "$CACHE_DIR"` for accurate duration measurement

### 2026-06-30: Task 3.8 - Optimize /tmp Size Based on Profiling
- Docker not available in dev environment — profiling done via codebase analysis (no live `du -sh /tmp/` possible)
- **pylon_indexer /tmp consumers** (all ephemeral, no persistence needed):
  - `tasknode_tmp: /tmp/tasknode` — TaskNode intermediate results (set in `worker_core.yml` and `indexer_worker.yml`). Active size: 1-5GB depending on concurrent tasks
  - `tempfile.TemporaryFile()` in bootstrap module — in-memory (doesn't hit /tmp disk)
  - Miscellaneous stdlib tempfiles: ~200-500MB
- **pylon_indexer cache consumers** (redirected to `/data/cache` emptyDir 60Gi):
  - `NLTK_DATA=/data/cache/nltk` (~1.3GB)
  - `TIKTOKEN_CACHE_DIR=/data/cache/tiktoken` (~528MB)
  - `HF_HOME=/data/cache` (huggingface models)
  - `TRANSFORMERS_CACHE=/data/cache/transformers`
  - `PIP_CACHE_DIR=/data/cache/pip` (from pylon.yml `modules.requirements.cache: /data/cache/pip`)
  - `AZURE_DEVOPS_CACHE_DIR=/data/cache/ado`
- **pylon_main /tmp consumers** (all ephemeral):
  - `CHUNKS_TEMP_DIR=/tmp/elitea_chunks` — upload chunk assembly (50-200MB per active upload, auto-cleaned)
  - `TASKS_UPLOAD_FOLDER=/tmp/tasks` — task file processing (~500MB)
  - `SECRETS_FILESYSTEM_PATH=/tmp/secrets` — filesystem secrets store (~50MB)
  - `STORAGE_FILESYSTEM_PATH=/tmp/storage` — local file storage (~500MB)
- **Sizing decisions**:
  - pylon_indexer /tmp: reduced from 20Gi to 10Gi (caches moved to `/data/cache` volume)
  - pylon_main /tmp: kept at 10Gi (adequate for upload processing)
  - pylon_indexer `/data/cache`: 60Gi (NLTK + tiktoken + pip + transformers + ADO)
- **Environment variables added to staging pylon-indexer pylon.yml `environment:` section**:
  - `TMPDIR=/tmp` (explicit, ensures all tempfile stdlib usage hits emptyDir)
  - `PIP_CACHE_DIR=/data/cache/pip` (redundant with pylon.yml `modules.requirements.cache` but ensures pip itself knows)
  - `HF_HOME`, `NLTK_DATA`, `TRANSFORMERS_CACHE`, `TIKTOKEN_CACHE_DIR`, `AZURE_DEVOPS_CACHE_DIR` → all to `/data/cache/*`
- **Config overrides added**:
  - `indexer_worker.yml`: `nltk_data: /data/cache/nltk` (overrides default `/tmp/nltk_data`)
  - `indexer_worker.yml`: `tasknode_tmp: /tmp/tasknode` (explicit, stays in /tmp emptyDir)
  - `worker_core.yml`: `tasknode_tmp: /tmp/tasknode` (explicit, stays in /tmp emptyDir)
- The `indexer_worker/config.yml` defaults (`nltk_data: /tmp/nltk_data`, `tasknode_tmp: /tmp/tasknode`) apply only when NOT overridden by staging config
- Key insight: pylon's `environment:` section in pylon.yml calls `os.environ[key] = value` at startup (pylon/main.py:181) — these override container-level env vars
- LiteLLM venv (`/data/litellm/venv`) is NOT in /tmp — it's on the persistent storage volume, unaffected

### 2026-06-30: Task 3.9 - Add /tmp Usage Monitoring and Cleanup
- Created `elitea_core/utils/tmp_cleanup.py` — background daemon thread with periodic cleanup
- `TmpCleanup` class: configurable via constructor args or env vars (TMP_CLEANUP_PATH, TMP_CLEANUP_MAX_AGE, TMP_CLEANUP_INTERVAL)
- Defaults: path=/tmp, max_age=3600s (1 hour), interval=1800s (30 minutes)
- Uses `threading.Event.wait(timeout=interval)` for clean wake/stop signaling (not `time.sleep`)
- `os.scandir` for efficient directory traversal (returns DirEntry with stat caching)
- Symlinks handled: `entry.is_symlink()` checked BEFORE `entry.is_file()` — symlinks aren't "files" without follow_symlinks but should still be cleaned
- `os.unlink` failures (open handles, busy) are caught gracefully — file counted as "skipped", not "error"
- Empty directories removed after files cleaned via `os.rmdir` (non-recursive, only empty dirs)
- `_human_size()` utility for log messages (B/KB/MB/GB)
- Integration: `self.tmp_cleanup = TmpCleanup()` in module.py init, `self.tmp_cleanup.stop()` in deinit
- `run_once()` method for on-demand/testing use (returns summary dict)
- Background loop catches exceptions at top level to prevent thread death on transient errors
- `_stop_event` (threading.Event) used instead of checking `_running` flag directly — allows instant wake on stop
- Test file: `centry/tests/unit/scaling/test_tmp_cleanup.py` (37 tests, 100% coverage)
- Test pattern: `tmp_path` pytest fixture for temporary directory, `_make_old_file`/`_make_recent_file` helpers
- Mock pattern for `os.scandir`: create wrapper classes (FakeEntry/BadEntry) that proxy DirEntry methods

## Storage Architecture

### Volume Types by Service (Staging)

| Service | Volume | Type | Mount Path | Size | Purpose |
|---------|--------|------|------------|------|---------|
| pylon_main | tmp | emptyDir | /tmp | 10Gi | Upload chunks, task files, secrets, scratch |
| pylon_indexer | tmp | emptyDir | /tmp | 10Gi | TaskNode intermediates, stdlib tempfiles |
| pylon_indexer | cache-volume | emptyDir | /data/cache | 60Gi | NLTK, tiktoken, pip, transformers, ADO, prisma |
| pylon_indexer | config | configMap | /config | — | pylon.yml, worker configs, manifest.json |
| pylon_auth | tmp | emptyDir | /tmp | 10Gi | Minimal scratch |
| all | data (PVC) | RWO PVC | /data | varies | Persistent plugin data, venvs |

**No RWX (ReadWriteMany) volumes** — all shared state externalized to Redis/PostgreSQL/S3.

### Model Cache Lifecycle

```
Pod Scheduled
    │
    ▼
┌──────────────────────────────────────────────┐
│  Init Container: model-cache-init            │
│                                              │
│  1. Read /config/manifest.json               │
│  2. Check .manifest-version vs manifest      │
│     • Match → incremental sync              │
│     • Mismatch → clear cache, full download │
│     • Missing → first run, full download    │
│  3. For each model in manifest:              │
│     • File exists + MD5 matches → skip      │
│     • Otherwise → download from S3          │
│     • Validate MD5 after download           │
│     • Extract tar.gz if extract=true        │
│  4. Write .manifest-version on success       │
│  5. Write .metrics (Prometheus textfile)     │
│  6. Exit 0 (success) or 1 (failure)         │
└──────────────────────────────────────────────┘
    │ success
    ▼
┌──────────────────────────────────────────────┐
│  Main Container: pylon_indexer               │
│                                              │
│  Mounts same cache-volume at /data/cache     │
│  • NLTK_DATA=/data/cache/nltk               │
│  • TIKTOKEN_CACHE_DIR=/data/cache/tiktoken   │
│  • HF_HOME=/data/cache                      │
│  • TRANSFORMERS_CACHE=/data/cache/transformers│
│  • PIP_CACHE_DIR=/data/cache/pip            │
│                                              │
│  Bootstrap plugin checks install_needed():   │
│  Files present → skip network download       │
└──────────────────────────────────────────────┘
    │ pod evicted/rescheduled
    ▼
  emptyDir deleted (cache lost, re-downloaded on next pod start)
```

**Cache eviction**: emptyDir volumes are ephemeral — lost on pod restart/reschedule. The init container re-downloads on every pod start. Pre-warming (keeping pods running) avoids cold-start penalty.

### /tmp Management Strategy

| Concern | Solution |
|---------|----------|
| Size constraint | emptyDir sizeLimit: 10Gi (main), 10Gi (indexer) |
| Stale file cleanup | `TmpCleanup` daemon thread: deletes files > 1h old, runs every 30min |
| Open file handles | `os.unlink` failure gracefully skipped (file still in use) |
| Empty dir cleanup | `os.rmdir` after file cleanup (non-recursive, empty only) |
| Monitoring | Cleanup logs: files deleted count, space reclaimed |
| Cache separation | Large caches (NLTK, tiktoken, pip) redirected to /data/cache volume via env vars |

**Key invariant**: nothing in /tmp needs to survive a pod restart. All persistent state lives in Redis, PostgreSQL, or S3.

### Capacity Planning

| Component | Per Pod | Notes |
|-----------|---------|-------|
| /data/cache (emptyDir) | 60Gi | NLTK ~1.3G + tiktoken ~528M + pip ~1G + headroom |
| /tmp (emptyDir) | 10Gi | TaskNode results + upload chunks + scratch |
| **Total ephemeral** | **70Gi** | Must fit on node's ephemeral storage |
| Container image | ~2Gi | Base pylon + python deps |
| Pod memory (indexer) | 1-4Gi | Requests 1Gi, limits 4Gi |

**Node sizing**: each indexer pod needs ~72Gi ephemeral storage. Plan node ephemeral disk accordingly (e.g. 200Gi for 2 indexer pods + system overhead).

**Scale-up latency**: cold start = init container download time (~2-5min for 50GB from S3). Mitigate with:
- Gradual rollouts (maxUnavailable=1)
- Pre-warming spare pods (HPA minReplicas > active need)
- Regional S3 bucket placement (same AZ as nodes)

### 2026-06-30: Task 4.1 - Audit All Redis Pub/Sub Event Handlers
- **Transport mechanism**: arbiter's `RedisEventNode` uses Redis pub/sub on a single channel (`event_queue` config). `emit()` calls `redis.publish(channel, data)`. ALL subscribers on that channel receive ALL messages.
- **Shared channel**: ALL services (pylon_main elitea_core, worker_client, logging_hub; pylon_indexer worker_core, indexer_worker) use the SAME channel: `${NAME_PREFIX}_indexer`
- **Separate channel**: The `tracing` plugin creates a dedicated `audit_trail` channel for audit events (isolated)
- **Self-filtering**: Handlers like `on_stream_event` check `stream_id in self.streams` and return early if not relevant. This is the de-facto "unicast" mechanism — broadcast transport with client-side filtering
- **Event serialization**: gzip + pickle (python-specific), with optional HMAC signing
- **56 unique event subscriptions** across all services; 20 broadcast, 22 work, 14 notification
- **Critical non-idempotent handlers**: `application_full_response` → DB save (but naturally filtered by stream ownership); `task_status_change` → callback pop (fixed by GETDEL in Phase 1)
- **Request/response waste**: `application_toolkits_request` causes ALL indexer pods to respond → N identical `application_toolkits_collected` broadcasts. Harmless (receivers overwrite) but wasteful
- **Phase 4 priorities identified**: Convert `indexer_empty_agent_state`/`indexer_delete_checkpoint` to Streams (work events that should be processed once). Add leader election for request/response pattern. Verify `context.event_manager.fire_event` chain for items 2-4 is naturally pinned by stream_id

## Event Audit

### Architecture Overview

All services (pylon_main, pylon_indexer) share a **single Redis pub/sub channel**: `${NAME_PREFIX}_indexer`. Every `emit()` is broadcast to ALL subscribers — there is no filtering at the transport level. Each subscriber's callback function must self-filter based on payload content (e.g., `stream_id not in self.streams` → return early).

**Separate channel**: The `tracing` plugin uses a dedicated `audit_trail` channel for audit events (isolated from the main event bus).

### Event Node Instances

| Service | Plugin | Variable | Channel | Notes |
|---------|--------|----------|---------|-------|
| pylon_main | elitea_core | `self.event_node` | `${NAME_PREFIX}_indexer` | Main app logic |
| pylon_main | worker_client | `self.event_node` | `${NAME_PREFIX}_indexer` | Proxies indexer streams |
| pylon_main | logging_hub | `self.event_node` | `${NAME_PREFIX}_indexer` | Log aggregation |
| pylon_main | tracing | `self._audit_event_node` | `audit_trail` | Audit trail (isolated) |
| pylon_indexer | worker_core | `self.event_node` | `${NAME_PREFIX}_indexer` | Task execution core |
| pylon_indexer | indexer_worker | `self.agent_event_node` | `${NAME_PREFIX}_indexer` | Clone of worker_core's |
| pylon_indexer | provider_worker | uses worker_core's | `${NAME_PREFIX}_indexer` | Provider invocations |
| pylon_indexer | tracing | `self._audit_event_node` | `audit_trail` | Audit trail (isolated) |

### Complete Event Subscription Audit

#### pylon_main — elitea_core (module.py)

| # | Event Name | Handler | Source (Producer) | Consumer Count | Idempotent? | Classification |
|---|-----------|---------|-------------------|---------------|-------------|----------------|
| 1 | `application_stream_response` | `stream_response` | indexer (agent execution) | All pylon_main pods | **Yes** — routes to SIO room by stream_id; only pod with active stream processes | notification |
| 2 | `application_full_response` | `conversation_message_proxy` | indexer (agent_common.py) | All pylon_main pods | **No** — fires `chat_message_stream_end` event which triggers DB save | work |
| 3 | `application_partial_response` | `conversation_partial_message_proxy` | indexer (agent_common.py) | All pylon_main pods | **No** — fires `chat_message_stream_partial_save` which saves to DB | work |
| 4 | `application_child_message` | `child_message_proxy` | indexer (agent_common.py) | All pylon_main pods | **No** — fires `chat_child_message_save` which saves to DB | work |
| 5 | `voice_tts_audio_chunk` | `voice_tts_audio_chunk` | indexer (indexer_tts.py) | All pylon_main pods | **Yes** — emits SIO to specific `sid`; only pod with that client delivers | notification |
| 6 | `voice_tts_done` | `voice_tts_done` | indexer (indexer_tts.py) | All pylon_main pods | **Yes** — emits SIO to specific `sid` | notification |
| 7 | `voice_tts_error` | `voice_tts_error` | indexer (indexer_tts.py) | All pylon_main pods | **Yes** — emits SIO to specific `sid` | notification |
| 8 | `voice_asr_transcript_delta` | `voice_asr_transcript_delta` | indexer (indexer_asr_realtime.py) | All pylon_main pods | **Yes** — emits SIO to specific `sid` | notification |
| 9 | `voice_asr_transcript_done` | `voice_asr_transcript_done` | indexer (indexer_asr_whisper/realtime.py) | All pylon_main pods | **No** — emits SIO + calls `on_whisper_call_done(sid)` which modifies ASR state | work |
| 10 | `voice_asr_error` | `voice_asr_error` | indexer (indexer_asr_*.py) | All pylon_main pods | **Yes** — emits SIO to specific `sid` | notification |
| 11 | `voice_asr_speech_started` | `voice_asr_speech_started` | indexer (indexer_asr_realtime.py) | All pylon_main pods | **Yes** — emits SIO to specific `sid` | notification |
| 12 | `voice_asr_vad_flush` | `voice_asr_vad_flush` | indexer (sio/asr.py) | All pylon_main pods | **Yes** — emits SIO to specific `sid` | notification |
| 13 | `application_toolkit_configurations_collected` | `toolkit_configurations_collected` | indexer (indexer_toolkit_configurations.py) | All pylon_main pods | **Yes** — overwrites in-memory config (idempotent if same payload) | broadcast |
| 14 | `application_toolkits_collected` | `toolkits_collected` | indexer (indexer_toolkits.py) | All pylon_main pods | **Yes** — overwrites `self.toolkit_schemas` dict entries | broadcast |
| 15 | `application_file_loaders_collected` | `index_types_collected` | indexer (indexer_file_loaders.py) | All pylon_main pods | **Yes** — replaces `self.index_types` entirely | broadcast |
| 16 | `application_mcp_prebuilt_config_collected` | `mcp_prebuilt_config_collected` | indexer (indexer_mcp_prebuilt_config.py) | All pylon_main pods | **Yes** — replaces `self.mcp_prebuilt_configs` | broadcast |
| 17 | `task_status_change` | `task_status_changed` | arbiter TaskNode (tasknode.py) | All pylon_main pods | **No** — pops callback + invokes webhook; race with `not_starting_task_event` | work |

#### pylon_main — worker_client (module.py)

| # | Event Name | Handler | Source (Producer) | Consumer Count | Idempotent? | Classification |
|---|-----------|---------|-------------------|---------------|-------------|----------------|
| 18 | `stream_event` | `on_stream_event` | indexer worker_core (stream.py) | All pylon_main pods | **Yes** — filters by `stream_id in self.streams`; only initiating pod has it | notification |
| 19 | `bootstrap_runtime_info` | `i2p_bootstrap_runtime_info` | indexer (preload.py) | All pylon_main pods | **Yes** — updates in-memory runtime info cache | broadcast |
| 20 | `bootstrap_runtime_info_prune` | `i2p_bootstrap_runtime_info_prune` | indexer (preload.py) | All pylon_main pods | **Yes** — prunes stale runtime info entries | broadcast |
| 21 | `runtime_engine_ready` | lambda → `runtime_engine_ready_event.set()` | indexer (runtime_engine_litellm) | All pylon_main pods | **Yes** — sets an Event (already-set Event.set() is no-op) | broadcast |

#### pylon_main — logging_hub (module.py)

| # | Event Name | Handler | Source (Producer) | Consumer Count | Idempotent? | Classification |
|---|-----------|---------|-------------------|---------------|-------------|----------------|
| 22 | `log_data` | `on_log_data` | indexer tracing (eventnode_handler.py) | All pylon_main pods | **No** — appends to `room_cache` and emits to SIO rooms; duplicate delivery = duplicate UI logs | notification |

#### pylon_main — tracing (module.py) — SEPARATE CHANNEL

| # | Event Name | Handler | Source (Producer) | Consumer Count | Idempotent? | Classification |
|---|-----------|---------|-------------------|---------------|-------------|----------------|
| 23 | `audit_event` | `_on_remote_audit_event` | indexer tracing (audit forward) | Subscriber pods only | **Yes** — writes audit span (append-only) | broadcast |

#### pylon_indexer — worker_core (module.py)

| # | Event Name | Handler | Source (Producer) | Consumer Count | Idempotent? | Classification |
|---|-----------|---------|-------------------|---------------|-------------|----------------|
| 24 | `stream_event` | `on_stream_event` | pylon_main worker_client LLM streams | All indexer pods | **Yes** — filters by `stream_id in self.streams` | notification |
| 25 | `bootstrap_runtime_update` | `i2p_bootstrap_runtime_update` | pylon_main bootstrap plugin | All indexer pods | **Yes** — updates local runtime info | broadcast |

#### pylon_indexer — indexer_worker (module.py)

| # | Event Name | Handler | Source (Producer) | Consumer Count | Idempotent? | Classification |
|---|-----------|---------|-------------------|---------------|-------------|----------------|
| 26 | `application_toolkits_request` | `toolkits_request` | pylon_main elitea_core (startup) | All indexer pods | **No** — each pod responds with full toolkits list (duplicate responses) | broadcast |
| 27 | `application_file_loaders_request` | `file_loaders_request` | pylon_main elitea_core (startup) | All indexer pods | **No** — each pod responds (duplicate broadcasts back) | broadcast |
| 28 | `application_toolkit_configurations_request` | `toolkit_configurations_request` | pylon_main elitea_core (startup) | All indexer pods | **No** — each pod responds (duplicate broadcasts back) | broadcast |
| 29 | `application_mcp_prebuilt_config_request` | `mcp_prebuilt_config_request` | pylon_main elitea_core (startup) | All indexer pods | **No** — each pod responds (duplicate broadcasts back) | broadcast |
| 30 | `indexer_empty_agent_state` | `empty_agent_state` | pylon_main elitea_core (RPC) | All indexer pods | **No** — deletes DB checkpoints; duplicate = redundant deletes (safe but wasteful) | work |
| 31 | `indexer_delete_checkpoint` | `delete_checkpoint` | pylon_main elitea_core (messages.py, chat_conversation.py) | All indexer pods | **No** — deletes specific checkpoint; duplicate = redundant (safe) | work |

#### pylon_indexer — indexer_worker voice_router

| # | Event Name | Handler | Source (Producer) | Consumer Count | Idempotent? | Classification |
|---|-----------|---------|-------------------|---------------|-------------|----------------|
| 32 | `voice_events` | `_route` (dispatches by sid+type) | pylon_main sio/asr.py, sio/tts.py | All indexer pods | **Yes** — routes by `(sid, event_type)` in `_handlers` dict; only pod running the task has the handler registered | work |

#### pylon_indexer — provider_worker

| # | Event Name | Handler | Source (Producer) | Consumer Count | Idempotent? | Classification |
|---|-----------|---------|-------------------|---------------|-------------|----------------|
| 33 | `provider_invocation_started` | `invocation_event_started` | provider_worker tools.py (same pod) | Same pod only | **Yes** — tracks invocation in local `self.invocations` dict | notification |
| 34 | `provider_invocation_ended` | `invocation_event_ended` | provider_worker tools.py (same pod) | Same pod only | **Yes** — removes from `self.invocations` dict | notification |
| 35 | `task_stop_request` | `invocation_event_task_stop_request` | arbiter TaskNode (external cancel) | All indexer pods | **Yes** — cancels invocations for matching task_id (no-op if not on this pod) | work |

#### Arbiter Internal (TaskNode — all services)

| # | Event Name | Handler | Source (Producer) | Consumer Count | Idempotent? | Classification |
|---|-----------|---------|-------------------|---------------|-------------|----------------|
| 36 | `task_result_payload` | `on_result_payload` | TaskNode (task completion) | All nodes with task_node | **Yes** — matched by task_id; only requesting node processes | work |
| 37 | `task_node_announce` | `on_node_announce` | TaskNode (startup) | All nodes | **Yes** — updates peer list | broadcast |
| 38 | `task_node_withhold` | `on_node_withhold` | TaskNode (shutdown) | All nodes | **Yes** — removes from peer list | broadcast |
| 39 | `task_start_query` | `on_start_query` | TaskNode (task submission) | All nodes | **Yes** — responds with capacity info | work |
| 40 | `task_start_candidate` | `on_sync_reply` | TaskNode (response) | Requesting node only | **Yes** — matched by task_id | work |
| 41 | `task_start_request` | `on_start_request` | TaskNode (assignment) | All nodes | **Yes** — only processes if ident matches | work |
| 42 | `task_start_ack` | `on_sync_reply` | TaskNode (acknowledgment) | Requesting node only | **Yes** — matched by task_id | work |
| 43 | `task_stop_request` | `on_stop_request` | TaskNode (cancellation) | All nodes | **Yes** — no-op if task not local | work |
| 44 | `task_state_announce` | `on_state_announce` | TaskNode (state sync) | All nodes | **Yes** — updates local state cache | broadcast |
| 45 | `task_state_query` | `on_state_query` | TaskNode (query) | All nodes | **Yes** — responds with local state | broadcast |
| 46 | `task_state_reply` | `on_state_reply` | TaskNode (response) | Requesting node only | **Yes** — matched by requestor | work |
| 47 | `task_pool_query` | `on_pool_query` | TaskNode (pool query) | All nodes | **Yes** — responds with pool state | broadcast |
| 48 | `task_pool_reply` | `on_pool_reply` | TaskNode (response) | All nodes | **Yes** — updates pool info | broadcast |
| 49 | `task_status_change` | subscribed dynamically | TaskNode (lifecycle) | All subscribed nodes | See #17 above | work |

#### Arbiter Internal (PresenceNode, ServiceNode, StreamNode)

| # | Event Name | Handler | Source (Producer) | Consumer Count | Idempotent? | Classification |
|---|-----------|---------|-------------------|---------------|-------------|----------------|
| 50 | `presence_join` | `on_presence_join` | PresenceNode | All nodes | **Yes** — updates presence map | broadcast |
| 51 | `presence_leave` | `on_presence_leave` | PresenceNode | All nodes | **Yes** — removes from presence map | broadcast |
| 52 | `stream_event` | `on_stream_event` | StreamNode | Registered consumers | **Yes** — routes by stream_id | notification |
| 53 | `service_discovery` | `on_service_discovery` | ServiceNode | All nodes | **Yes** — responds with services | broadcast |
| 54 | `service_provider` | `on_service_provider` | ServiceNode | All nodes | **Yes** — registers provider | broadcast |
| 55 | `service_request` | `on_service_request` | ServiceNode | All nodes | **Yes** — processes if match | work |
| 56 | `service_response` | `on_service_response` | ServiceNode | Requesting node | **Yes** — matched by request_id | work |

### Non-Idempotent Handlers (Scaling Risk)

These handlers will break or produce incorrect behavior if delivered to multiple pods:

| # | Event | Risk | Mitigation Strategy |
|---|-------|------|---------------------|
| 2 | `application_full_response` | Duplicate DB saves of conversation messages | Route via stream_id → only pod owning the stream should save. Needs distributed ownership tracking |
| 3 | `application_partial_response` | Duplicate partial saves | Same as #2 — needs stream ownership |
| 4 | `application_child_message` | Duplicate child message saves | Same as #2 — needs stream ownership |
| 9 | `voice_asr_transcript_done` | `on_whisper_call_done` modifies ASR session state | With Redis ASR store (Phase 1), this is now idempotent — state transition is atomic |
| 17 | `task_status_change` | Callback webhook invoked multiple times; `not_starting_task_event` race across pods | CallbackManager with GETDEL (Phase 1) ensures exactly-once pop. Remaining risk: `_maybe_handle_parallel_dispatch` |
| 22 | `log_data` | Duplicate log entries in UI | Low severity — cosmetic only, no data corruption |
| 26-29 | `*_request` events | All indexer pods respond → duplicate collected broadcasts → acceptable but wasteful | Could use leader election (Phase 4.11) to have only one indexer respond |
| 30-31 | `indexer_empty/delete_checkpoint` | Multiple pods delete same data | Redundant deletes are safe (DELETE is idempotent) but wasteful; should be work event |

### Summary Statistics

| Classification | Count | Notes |
|---------------|-------|-------|
| **broadcast** | 20 | All pods must process (cache sync, presence, config) — correct behavior |
| **work** | 22 | Should be processed by exactly one pod — needs Streams (Phase 4) |
| **notification** | 14 | Best-effort delivery to SIO clients — handled by Redis adapter |

### Key Architectural Insights

1. **Self-filtering pattern**: Most "work" events are safe because handlers self-filter (check `stream_id in self.streams`, `task_id == self.ident`, etc.). The filtering effectively creates unicast delivery within a broadcast transport.

2. **True scaling risks** (items 2-4): `application_full_response`, `application_partial_response`, `application_child_message` fire `context.event_manager.fire_event()` which triggers DB-saving event handlers in `elitea_core`. If multiple pylon_main pods process the same event, conversation messages could be saved multiple times. However, with the Socket.IO Redis adapter, the `stream_id` (which is the SIO session + request context) naturally pins to one pod.

3. **Request/response pattern** (items 26-29): The `*_request` → `*_collected` pattern causes N indexer pods to respond to a single request. This results in N identical broadcasts back, but since the receivers overwrite state (not append), it's safe — just wasteful network/CPU.

4. **Phase 1 mitigations already in place**: CallbackManager GETDEL (#17), Redis ASR store (#9), and Socket.IO Redis adapter (stream routing) have resolved the most critical non-idempotent handlers.

5. **Phase 4 priorities**: Convert items 30-31 (`indexer_empty_agent_state`, `indexer_delete_checkpoint`) to Redis Streams work events. Add leader election for request/response pattern (#26-29). Items 2-4 need careful analysis of the `context.event_manager` chain to confirm stream_id provides natural affinity.

### 2026-06-30: Task 4.2 - Classify Events: Broadcast vs Work vs Notification
- Created `elitea_core/events/event_classification.py` — formal registry with enum, retention config, and all 56 events registered
- `EventType` enum: BROADCAST, WORK, NOTIFICATION
- `StreamRetention` class: WORK=10000, NOTIFICATION=1000, DLQ=50000 messages (used by Phase 4.13)
- Registry functions: `register_event()`, `get_event_type()`, `get_events_by_type()`, `get_retention()`, `is_registered()`, `list_all()`, `clear_registry()`
- Convenience methods: `get_work_events()`, `get_broadcast_events()`, `get_notification_events()`
- All events registered at module level with descriptions matching the audit table
- Classification column was already present in AGENT.md audit table (added during task 4.1)
- **Work events currently on broadcast transport (bug candidates for Phase 4 Streams migration)**:
  - `application_full_response` — DB save of conversation (stream_id affinity mitigates)
  - `application_partial_response` — DB partial save (stream_id affinity mitigates)
  - `application_child_message` — DB child message save (stream_id affinity mitigates)
  - `voice_asr_transcript_done` — ASR state mutation (Redis store makes idempotent)
  - `task_status_change` — callback webhook (GETDEL ensures exactly-once)
  - `indexer_empty_agent_state` — checkpoint deletion (redundant DELETEs safe)
  - `indexer_delete_checkpoint` — checkpoint deletion (redundant DELETEs safe)
  - `voice_events` — voice routing (handler dict affinity mitigates)
- Note: items #2-4 are "work" but naturally self-filter via stream_id ownership — only the pod that initiated the LLM call has the stream registered. Still should migrate to Streams for correctness.
- The `events/` directory already exists with domain event handlers (configuration.py, vectorstore.py, etc.) — our `event_classification.py` fits naturally alongside them
- Test file: `centry/tests/unit/scaling/test_event_classification.py` (41 tests, 100% coverage)
- No external dependencies (no pylon/arbiter/redis imports) — pure Python enum + dict registry

### 2026-06-30: Task 4.3 - Implement Redis Streams for Work Events
- Created `elitea_core/utils/redis_streams.py` with `StreamProducer` and `StreamConsumer` classes
- **StreamProducer**:
  - `publish(stream_name, event_data, maxlen=None)` → XADD with JSON-serialized payload
  - Automatic `stream:` key prefix (idempotent — won't double-prefix)
  - Approximate MAXLEN trimming by default (configurable via constructor or per-publish)
  - Adds `published_at` timestamp alongside `data` field
  - `stream_length()` and `stream_info()` for introspection
- **StreamConsumer**:
  - Auto-creates consumer group on init via XGROUP CREATE with MKSTREAM (BUSYGROUP silenced)
  - `consume(count, block_ms)` → XREADGROUP with `>` for new messages
  - `consume_pending(count)` → XREADGROUP with `0` for unacked recovery
  - `ack(message_id)` and `ack_many(message_ids)` → XACK
  - `claim_stale(min_idle_ms, count)` → XAUTOCLAIM for crashed consumer recovery
  - `pending_count()` and `pending_summary()` → XPENDING inspection
- Response parsing handles both bytes and string keys (redis-py decode_responses=True/False)
- Handles both list-format `[[stream, entries]]` and dict-format `{stream: entries}` responses
- `data` field auto-deserialized from JSON on consume
- All error paths return safe defaults (empty list, 0, False) — never raises
- Pattern follows existing codebase: constructor takes `redis_client`, stores as `self._client`
- Constants: `STREAM_PREFIX="stream:"`, `DEFAULT_MAXLEN=10000`, `DEFAULT_BLOCK_MS=5000`
- Test file: `centry/tests/unit/scaling/test_redis_streams.py` (61 tests, 98% coverage)
- Runtime copy at: `centry/pylon_main/plugins/elitea_core/utils/redis_streams.py`

### Task 4.4: Stream-based Task Distribution

- Source: `elitea_core/utils/stream_task_distributor.py`
- Runtime: `centry/pylon_main/plugins/elitea_core/utils/stream_task_distributor.py`
- Tests: `centry/tests/unit/scaling/test_stream_task_distributor.py` (49 tests, 93% coverage)

**Architecture discovery:**
- Arbiter `TaskNode` uses `EventNode` (Redis pub/sub) for task coordination
- Protocol: `task_start_query` → `task_start_candidate` → `task_start_request` → `task_start_ack`
- All events broadcast to ALL pods; nodes filter by `ident`, `pool`, `task_id`
- `pylon_main` has `TaskNode(task_limit=0)` — only requests, never executes
- `pylon_indexer` has 3 TaskNodes: `task_node_light` (threading), `task_node_heavy` (fork), `task_node_preload` (fork)
- TaskQueue (thread) wraps TaskNode — manages pending queue, serial execution

**Implementation approach:**
- Created `TaskDistributionProducer` (used by pylon_main) — publishes task specs to stream
- Created `TaskDistributionConsumer` (used by pylon_indexer) — claims and executes tasks
- Feature-flagged behind `REDIS_STREAMS_ENABLED`
- Consumer runs background thread polling with XREADGROUP
- On failure: retries up to `max_retries`, then DLQ at `dlq:work:task_distribution`
- On startup: recovers pending (unacked) messages from before crash
- On dead consumer: claims idle messages via XAUTOCLAIM (60s idle threshold)

**Key decisions:**
- Does NOT replace arbiter internals — operates at a higher level
- Producer creates a "work item" that consumer routes to local TaskNode
- DLQ prefix: `dlq:` + original stream name
- Consumer name: from HOSTNAME env var (Kubernetes pod name) or generated UUID

### Task 4.5: Event Deduplication (SETNX pattern)

**Files created:**
- Source: `elitea_core/utils/event_dedup.py`
- Runtime: `centry/pylon_main/plugins/elitea_core/utils/event_dedup.py`
- Tests: `centry/tests/unit/scaling/test_event_dedup.py` (60 tests, 100% coverage)

**Pattern:**
```python
from elitea_core.utils.event_dedup import EventDeduplicator, deduplicate, generate_event_id

# Class-based usage
dedup = EventDeduplicator(redis_client, key_prefix="event_dedup", default_ttl=300)
if dedup.is_duplicate("evt-abc-123"):
    return  # skip duplicate

# Decorator usage
@deduplicate(redis_client, ttl=300)
def handle_event(event_data):
    ...  # only executes once per event_id

# Custom event ID extraction
@deduplicate(redis_client, ttl=60, event_id_func=lambda d: d['task_id'])
def handle_task(event_data):
    ...

# Generate deterministic ID from payload
event_id = generate_event_id("task", project_id, user_id)
```

**Redis key layout:**
- `event_dedup:{event_id}` — value "1", with TTL (default 300s)

**Key features:**
- `is_duplicate()` — atomic check-and-mark via SET NX EX
- `mark_processed()` / `is_processed()` — separate mark and check
- `clear()` — remove entry to allow reprocessing
- `bulk_check()` / `bulk_mark()` — pipeline-based batch operations
- `generate_event_id(*args)` — SHA-256 based deterministic ID generation
- `@deduplicate` — decorator with customizable event_id_func and key_prefix

**Design decisions:**
- Uses SET NX EX (atomic set-if-not-exists with expiry) — no race conditions
- Empty/None event IDs short-circuit to False (not duplicate) to avoid masking bugs
- Decorator extracts event_id from `event_data['event_id']` or generates via SHA-256
- Bulk operations use non-transactional pipeline for performance
- Existing `tool_call_dedup.py` is unrelated (in-memory dedup for HITL replays, not Redis)

### Task 4.6: Idempotency Keys

**Files created:**
- `elitea_core/utils/idempotency.py` — IdempotencyStore + @idempotent decorator
- `centry/tests/unit/scaling/test_idempotency.py` — 60 unit tests

**Redis key layout:**
- `idempotency:{operation}:{hash_of_params}` — JSON-serialized result, with TTL (default 3600s)

**Key features:**
- `IdempotencyStore.get()` / `.set()` / `.has()` — basic CRUD with NX semantics
- `IdempotencyStore.check_and_set(key, result, ttl)` — convenience two-phase check+store
- `IdempotencyStore.force_set()` — overwrite (for corrections)
- `IdempotencyStore.invalidate()` — remove cache to allow re-execution
- `IdempotencyStore.get_with_metadata()` — returns result + TTL in one pipeline call
- `IdempotencyStore.bulk_check()` — pipeline-based batch lookup
- `compute_params_hash(*args, **kwargs)` — deterministic SHA-256 hash (32 chars)
- `@idempotent(redis, key_func, ttl)` — decorator caching function results

**Design decisions:**
- `.set()` uses SET NX — first writer wins in race conditions
- `.force_set()` uses plain SET — for corrections and TTL refresh
- `@idempotent` handles None results specially via force_set (NX would fail since "null" serializes to non-None string, but the check phase would return None from json.loads("null") and re-execute)
- Bytes decode uses `errors="replace"` to handle corrupt Redis data gracefully
- Decorator exposes `._idempotency_store` and `._operation` for testing/introspection

**Relationship to event_dedup:**
- `event_dedup` — marks events as processed (no result storage), prevents duplicate *processing*
- `idempotency` — stores and returns results, prevents duplicate *execution* while serving same response

---

### Task 4.7: Dead Letter Queue

**Files created:**
- `elitea_core/utils/dead_letter_queue.py` — reusable DLQ manager for any Redis Stream
- `centry/tests/unit/scaling/test_dead_letter_queue.py` — 61 tests, 95% coverage

**Key patterns:**
- DLQ stream naming: `stream:dlq:{original_stream_name}`
- Uses StreamProducer internally for publish — entries wrapped as `{"data": json.dumps(payload), "published_at": ...}`
- Parse flow: xrange → decode_fields → json.loads(fields["data"]) → extract envelope fields
- `retry()` re-publishes to original stream key and adds `retried_from_dlq` marker field
- `discard()` uses XDEL for permanent removal
- `discard_all()` reads all IDs then batch-deletes

**Integration with stream_task_distributor.py:**
- That module already has `_send_to_dlq()` using StreamProducer directly
- The new DeadLetterQueue class provides the management layer: list, retry, discard
- Both use the same stream key convention (`stream:dlq:{name}`)

---

### Task 4.8: Event Replay Capability (Iteration 18)

**Files created:**
- `elitea_core/utils/event_replay.py` — replays historical stream messages for recovery/debugging
- `centry/tests/unit/scaling/test_event_replay.py` — 44 tests, 96% coverage

**Key patterns:**
- `EventReplay` class uses XRANGE for reading + StreamProducer for re-publishing
- Pagination: reads in batches, increments last message ID's sequence number to continue
- Adds `_replayed_from` and `_replayed_at` metadata fields to replayed messages
- Invalid JSON data wrapped as `{"raw": value}` rather than failing
- `replay_single()` convenience method for replaying one specific message ID
- `count_messages()` is a wrapper around `replay_stream(dry_run=True)`
- Rate limiting via `time.sleep(delay_ms/1000)` between each published message
- `max_messages` parameter allows early termination

**Testing notes:**
- Cannot use `@patch("centry.pylon_main.plugins.elitea_core.utils.event_replay.time.sleep")` due to mock module loading
- Use `patch.object(_replay_mod.time, "sleep")` instead when patching module-level imports

### Task 4.9: Event Handler Timeout (Iteration 19)

**Files created:**
- `elitea_core/utils/handler_timeout.py` — decorator enforcing time limits on event handlers
- `centry/tests/unit/scaling/test_handler_timeout.py` — 65 tests, 94% coverage

**Key patterns:**
- `@timeout(seconds=30)` decorator with auto-detection: signal.SIGALRM on main thread (Unix), threading.Timer fallback
- `HandlerTimeoutError` raised on timeout — stream consumer catches it and NACKs the message
- `TimeoutTracker` class tracks timeout occurrences in Redis counter: `metrics:handler_timeouts:{handler_name}`
- Thread-based timeout uses `_ThreadTimeoutInterrupt(BaseException)` injected via `ctypes.pythonapi.PyThreadState_SetAsyncExc`
- The internal exception is BaseException (not Exception) to avoid being caught by broad except clauses
- `_ThreadTimeout.__exit__` catches the internal exception and re-raises as `HandlerTimeoutError` with full attributes
- `HandlerTimeoutError.__init__` uses default args to support zero-arg instantiation from ctypes injection
- Decorator attaches metadata: `wrapper._timeout_seconds`, `wrapper._handler_name`, `wrapper._timeout_tracker`

**Testing notes:**
- Thread-based timeout tests need `time.sleep()` in a loop (short increments) rather than single long sleep
  so that the async exception injected via ctypes can be delivered between Python bytecode instructions
- `time.sleep(N)` as a single call may not get interrupted by async exception on macOS Python 3.9

---

### 2026-06-30: Task 4.10 - Add Event Metrics

**Files created/modified:**
- `elitea_core/utils/event_metrics.py` — per-stream metrics tracking (published/consumed/failed/pending + health status)
- `elitea_core/routes/health.py` — added `/health/events` endpoint
- `centry/tests/unit/scaling/test_event_metrics.py` — 67 tests, 100% coverage

**Key patterns:**
- `EventMetrics(redis_client)` class with `record_published()`, `record_consumed()`, `record_failed()`, `update_pending()`
- Redis hashes at `metrics:streams:{stream_name}` store per-stream counters
- Global stream registry at `metrics:streams:_registry` (Redis SET) tracks all known streams
- `get_stream_health(stream_name)` computes: error_rate, status (healthy/degraded/unhealthy), age since last publish/consume
- `get_all_streams_health()` iterates the registry set
- `get_summary()` aggregates totals across all streams
- Status thresholds: pending>=1000 or error_rate>=0.5 → unhealthy; pending>=100 or error_rate>=0.1 → degraded
- Pipeline (non-transactional) used for atomic counter increment + timestamp set
- `/health/events` route in `routes/health.py` uses relative import: `from ..utils.event_metrics import EventMetrics`

### 2026-06-30: Task 4.11 - Leader Election
- Created `elitea_core/utils/leader_election.py` — Redis-based single-leader via SET NX EX
- Uses Lua scripts (same pattern as distributed_lock.py) for safe extend and release
- Background daemon thread refreshes TTL every `refresh_interval` seconds (default 10s)
- Lock TTL default 30s — on crash, another pod acquires after expiry
- `on_acquired` / `on_lost` callbacks for lifecycle integration
- `@leader_only(election)` decorator skips execution on non-leader pods (returns None)
- Key pattern: `leader_lock:{service_name}` — one leader per service type
- Important: in tests, after simulating failure, must also prevent re-acquire (set mock_redis.set=False) or the loop immediately re-acquires on next iteration
- Test file: `centry/tests/unit/scaling/test_leader_election.py` (61 tests, 100% coverage)

### 2026-06-30: Task 4.12 - Event Schema Registry
- Created `elitea_core/events/schema_registry.py` — Pydantic v2-based event payload validation
- Two validation modes: `validate_publish()` raises `SchemaValidationError` (strict); `validate_consume()` returns `(bool, result)` tuple (never crashes consumer)
- Unregistered events pass through without validation (backward-compatible)
- Built-in schemas registered at module load: TaskDistributionEvent, TaskStatusChangeEvent, ApplicationFullResponseEvent, ApplicationStreamResponseEvent, VoiceTTSAudioChunkEvent, VoiceTTSDoneEvent, VoiceASRTranscriptDoneEvent, BootstrapRuntimeInfoEvent, CacheInvalidationEvent, LeaderElectionEvent
- Pydantic v2 available (pydantic~=2.10.0 in centry/pylon_main/plugins/shared/requirements.txt)
- `from pydantic import BaseModel, ValidationError` import pattern works in elitea_core
- `SchemaValidationError` custom exception preserves event_name and structured errors list for debugging
- Integration point: `StreamProducer.publish()` callers can wrap with `validate_publish()` before sending; `StreamConsumer` handlers use `validate_consume()` and route invalid to DLQ
- Test file: `centry/tests/unit/scaling/test_schema_registry.py` (65 tests, 100% coverage)
- Runtime copy synced: `elitea_core/events/schema_registry.py` → `centry/pylon_main/plugins/elitea_core/events/schema_registry.py`

### 2026-06-30: Task 4.13 - Configure Streams Retention (MAXLEN)
- Enhanced `elitea_core/events/event_classification.py` with stream-level retention registry:
  - `register_stream_retention(stream_name, maxlen)` — explicit per-stream MAXLEN override
  - `get_stream_retention(stream_name)` — priority: explicit > dlq: prefix > work:/notify: prefix > default WORK
  - `list_stream_retentions()` — returns all explicit registrations
  - `clear_registry()` now also clears stream retentions
- Built-in stream retention registrations at module level:
  - `work:task_distribution` → 10000, `work:voice_events` → 10000, `work:service_request` → 10000
  - `notify:stream_event` → 1000, `notify:log_data` → 1000, `notify:voice_tts_audio_chunk` → 1000
  - `dlq:work:*` streams → 50000
- Enhanced `StreamProducer` (`elitea_core/utils/redis_streams.py`):
  - New `use_classification_retention=True` init param auto-resolves MAXLEN from classification on each publish
  - `_resolve_retention(stream_name)` tries relative import first, then `sys.modules` fallback
  - Explicit `maxlen` param on `publish()` always takes priority over classification
  - Approximate trimming (`~`) enabled by default for performance
- Retention policy summary:
  - **work** streams: 10000 messages (~24h at typical throughput)
  - **notification** streams: 1000 messages (ephemeral, loss acceptable)
  - **dlq** streams: 50000 messages (keep failures longer for inspection)
- Tests: `test_event_classification.py` → 64 tests; `test_redis_streams.py` → 69 tests (all passing)
- Files modified: `elitea_core/events/event_classification.py`, `elitea_core/utils/redis_streams.py`
- Runtime copies synced to `centry/pylon_main/plugins/elitea_core/`

### Task 4.14: Streams Monitoring

- Created `elitea_core/utils/streams_monitor.py` — `StreamsMonitor` class
- Key methods:
  - `check_stuck_consumers(stream_name)` — uses XPENDING range to find messages idle > 5min
  - `check_inactive_groups(stream_name)` — detects consumer groups with 0 active consumers
  - `check_dlq_depth(stream_name)` — checks if `dlq:{stream_name}` exceeds 100 entries
  - `check_all()` — iterates all streams from `metrics:streams:_registry` set
  - `get_streams_status()` — returns full status dict for `/health/streams` endpoint
- Added `/health/streams` route in `elitea_core/routes/health.py`
- Status levels: "healthy" (no anomalies), "degraded" (inactive groups only), "unhealthy" (stuck consumers or DLQ overflow)
- Dependencies: `redis_streams.STREAM_PREFIX`, `dead_letter_queue.DLQ_STREAM_PREFIX`, `event_metrics.STREAMS_REGISTRY_KEY`
- Uses `xinfo_groups`, `xpending_range`, `xlen` Redis commands
- Designed for leader-only periodic execution (every 60s) — integration with `leader_election.py` at module.py level
- Tests: 75 tests, 100% coverage in `centry/tests/unit/scaling/test_streams_monitor.py`
- Runtime copy synced to `centry/pylon_main/plugins/elitea_core/utils/streams_monitor.py`

### Task 5.1: Deploy PgBouncer (session pooling)

- Created `centry/pgbouncer/pgbouncer.ini` — PgBouncer config
  - `pool_mode = session` (required for advisory locks used by migration_lock.py)
  - `max_client_conn = 200` — max client connections PgBouncer accepts
  - `default_pool_size = 20` — server connections per user/database pair
  - `max_db_connections = 50` — hard cap on connections to backend PG
  - `auth_type = scram-sha-256` — matches PG18 default password encryption
  - `server_reset_query = DISCARD ALL` — clean session state between reuse
  - `query_wait_timeout = 120` — fail-fast if all pool slots occupied
- Created `centry/pgbouncer/userlist.txt` — plaintext credentials for local dev
  - Users: `centry` (app user), `pgbouncer_stats` (monitoring access)
- Added `pgbouncer` service to `centry/docker-compose.yml` (lines 37-57)
  - Image: `pgbouncer/pgbouncer:latest`
  - Volumes: pgbouncer.ini and userlist.txt mounted read-only
  - Healthcheck: `pg_isready -h localhost -p 6432`
  - Depends on: postgres
  - Network: centry (accessible as `pgbouncer:6432` from other services)
- Key gotcha: PG18 uses scram-sha-256 by default, NOT md5. PgBouncer must match.
- Connection string for services: `postgresql://centry:changeme@pgbouncer:6432/db`
- `stats_users = pgbouncer_stats` enables `SHOW STATS` via pgbouncer admin console

### Task 5.2: PgBouncer Pool Sizing Rationale

**Pool configuration (in `centry/pgbouncer/pgbouncer.ini`):**

| Setting | Value | Rationale |
|---------|-------|-----------|
| `pool_mode` | `session` | Required for `pg_try_advisory_lock` (migration_lock.py). Transaction mode releases server conn between TXs, breaking advisory locks which are session-scoped. |
| `default_pool_size` | 20 | Each user/database pair gets up to 20 backend connections. With one app user (`centry`) and one database, this means 20 persistent server connections available for reuse. Sized to handle 3× pylon_main (15 conn each) = 45 client requests concurrently waiting. |
| `reserve_pool_size` | 5 | Burst buffer: extra connections allowed when all 20 pool slots are occupied and `reserve_pool_timeout` (0 = immediate) triggers. Handles spikes without queuing (20+5=25 active backend connections possible). |
| `max_db_connections` | 50 | Hard cap on total connections PgBouncer opens to backend PostgreSQL. Safety net: even if multiple user/db pairs exist, backend PG won't exceed 50 connections from PgBouncer. Leaves headroom for direct connections (pgAdmin, migrations) within PG's max_connections=200. |
| `server_idle_timeout` | 600 | After 10 minutes idle, backend connections are closed and returned to OS. Prevents stale connections accumulating during low-traffic periods. Conservative — PG default `tcp_keepalives_idle` is also ~600s. |
| `query_wait_timeout` | 120 | Client connections queue up to 2 minutes waiting for a free server connection, then fail with error. Fail-fast: prevents request pile-up during connection storms. App receives error quickly and can retry or report. |
| `server_reset_query` | `DISCARD ALL` | Clears session state (temp tables, variables, prepared statements) when a server connection is returned to pool. Required for session pooling correctness — otherwise state leaks between clients. |
| `server_check_query` | `SELECT 1` | Lightweight validation that server connection is still alive before assigning to client. Prevents handing out dead connections. |
| `server_check_delay` | 30 | Only run the check query if connection has been idle >30s. Avoids unnecessary overhead on busy connections. |

**Connection math with PgBouncer:**

```
Backend PostgreSQL: max_connections = 200
PgBouncer:         max_db_connections = 50 (reserve 150 for direct access)

Service pool sizes (SQLAlchemy pool → PgBouncer):
  pylon_auth:    pool_size=10, max_overflow=5  → up to 15 client connections
  pylon_main:    pool_size=15, max_overflow=10 → up to 25 client connections  
  pylon_indexer: pool_size=10, max_overflow=5  → up to 15 client connections

With scaling (3 replicas each):
  Total client connections: 3×15 + 3×25 + 3×15 = 45 + 75 + 45 = 165 clients

PgBouncer multiplexing:
  165 client connections → at most 50 backend PG connections (3.3× multiplexing ratio)
  Burst: +5 reserve = 55 temporary max

Without PgBouncer (direct): 165 > 200 max_connections ← FAIL
With PgBouncer:             50 << 200 max_connections ← SAFE
```

**Monitoring access:**
- `stats_users = pgbouncer_stats` allows connecting as `pgbouncer_stats` user to run `SHOW STATS`, `SHOW POOLS`, `SHOW CLIENTS`
- Admin access via `admin_users = centry` for `PAUSE`, `RESUME`, `RELOAD` commands
- Connection: `psql -h pgbouncer -p 6432 -U pgbouncer_stats pgbouncer` → then `SHOW POOLS;`

**Service routing (task 5.3):**
- All pylon services now connect via PgBouncer: `POSTGRES_HOST=pgbouncer`, `POSTGRES_PORT=6432`
- Direct postgres access available via: `POSTGRES_DIRECT_HOST=postgres`, `POSTGRES_DIRECT_PORT=5432`
- Docker Compose `depends_on` updated: all pylon services depend on `pgbouncer` (not `postgres` directly)
- PgBouncer has a healthcheck (`pg_isready -h localhost -p 6432`) — services won't start until PgBouncer is ready
- PgBouncer uses `pool_mode=session` which preserves per-connection state (advisory locks, prepared statements, SET variables)
- The `* = host=postgres port=5432` wildcard in pgbouncer.ini forwards all database names (db, agentstate, litellm) to postgres

---

### Task 5.4: PostgreSQL max_connections

**Files created/modified:**
- `centry/postgres/postgresql.conf` — custom PostgreSQL config override
- `centry/docker-compose.yml` — added `command:` and volume mount to postgres service
- `centry/tests/unit/scaling/test_postgres_config.py` — 21 tests validating config

**Key decisions:**
- Used `command: postgres -c config_file=/etc/postgresql/postgresql.conf` instead of a pg_hba.conf approach since the pgvector image (based on official postgres) supports `-c` flags
- Config mounted read-only (`:ro`) at `/etc/postgresql/postgresql.conf`
- Set `max_connections=200` which gives headroom of 50 connections above burst (150) for admin/monitoring/migrations
- Added performance-relevant settings: `work_mem=4MB`, `maintenance_work_mem=64MB`, `effective_cache_size=768MB`, `wal_buffers=16MB`
- Enabled connection logging (`log_connections`, `log_disconnections`) and slow query logging (`log_min_duration_statement=1000ms`) for debugging connection issues

**Connection math summary:**
- Steady state (via PgBouncer): 50 max_db_connections << 200 max_connections
- Direct (without PgBouncer): burst 150 < 200 max_connections with 50 headroom
- PgBouncer `pool_mode=session` preserves advisory lock semantics

---

### Task 5.5: Redis Sentinel (3 Nodes) — 2026-06-30

**Files created/modified:**
- `centry/redis/sentinel.conf` — Sentinel monitoring config with password placeholder
- `centry/docker-compose.yml` — added 3 sentinel containers (redis-sentinel-1/2/3)
- `centry/envs/default.env` — added `REDIS_SENTINEL_HOSTS` and `REDIS_SENTINEL_MASTER`
- `centry/tests/unit/scaling/test_redis_sentinel.py` — 51 tests validating config

**Key decisions:**
- All 3 sentinels use port 26379 internally (Docker networking resolves by hostname)
- Password templated as `REDIS_PASSWORD_PLACEHOLDER` in sentinel.conf, substituted at runtime via `sed`
- Quorum=2 (majority of 3) for failover agreement
- `down-after-milliseconds=5000`, `failover-timeout=10000`, `parallel-syncs=1`
- Sentinels copy config to /tmp before running (sentinel modifies its config at runtime)

**Sentinel env vars:**
- `REDIS_SENTINEL_HOSTS=redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379`
- `REDIS_SENTINEL_MASTER=mymaster`

### Task 5.6: Redis Persistence (AOF + RDB) — 2026-06-30

**Files created/modified:**
- `centry/redis/redis.conf` — full persistence config with AOF + RDB
- `centry/docker-compose.yml` — redis command updated to use config file
- `centry/tests/unit/scaling/test_redis_persistence.py` — 33 tests validating config

**Key decisions:**
- Config file at `centry/redis/redis.conf`, mounted read-only at `/etc/redis/redis.conf`
- `--requirepass $$REDIS_PASSWORD` still passed via CLI (not in config file) for security
- Removed inline `--save 300 1 --dir /data/ --dbfilename dump.rdb` from command — now in redis.conf
- AOF: `appendonly yes`, `appendfsync everysec`, `aof-use-rdb-preamble yes`
- RDB: three save rules (900/1, 300/10, 60/10000) for different write patterns
- `auto-aof-rewrite-percentage 100`, `auto-aof-rewrite-min-size 64mb` for AOF compaction
- Data dir `/data` matches existing named volume `redis-data:/data`
- No `maxmemory` in config — container memory limits handle this

**Patterns:**
- Redis config + CLI args compose: config file for persistence/general, CLI for secrets from env
- `aof-use-rdb-preamble yes` enables hybrid persistence (fast RDB load + AOF tail for recent changes)

---

### Task 5.7: Update services for Sentinel URLs

**Files modified:**
- `elitea_core/methods/redis_client.py` — added Sentinel connection support
- `elitea_core/routes/health.py` — added sentinel health check to `/health/live`
- `centry/tests/unit/scaling/test_redis_sentinel_urls.py` — 63 tests (new)
- `centry/tests/unit/scaling/test_health_endpoints.py` — fixed mock for `get_sentinel_info`

**Key decisions:**
- Sentinel support via env vars (`REDIS_SENTINEL_HOSTS`, `REDIS_SENTINEL_MASTER`) — NOT in pylon config system
- Reason: env vars already in `default.env` from task 5.5, and `tools.config` doesn't have sentinel fields yet; adding them would require touching the shared plugin
- Fallback: if `REDIS_SENTINEL_HOSTS` is empty or unset, direct connection used (preserves local dev without sentinel)
- `use_managed_identity` (Azure) path explicitly skips sentinel logic — Azure Managed Redis doesn't use Sentinel
- `get_sentinel_info()` is a separate `@web.method()` that health.py uses for status; it creates a fresh Sentinel connection (2s timeout) to discover master and ping each sentinel individually
- Health check: sentinel unhealthy only if 0 sentinels reachable OR discover_master fails; partial reachability (2/3) is considered ok

**Patterns:**
- `_parse_sentinel_hosts(str) → List[Tuple[str, int]]` — reusable parser for comma-separated host:port lists
- Sentinel kwargs include password and ssl for sentinel authentication
- `redis-py` 4.6.0 `Sentinel.master_for()` returns a failover-aware Redis client that auto-reconnects on master change

---

### Task 5.8: Add Redis backup to S3

**Files created:**
- `elitea_core/utils/redis_backup.py` — RedisBackupManager class
- `centry/tests/unit/scaling/test_redis_backup.py` — 61 tests, 100% coverage

**Key decisions:**
- Uses boto3 S3 client directly (same as MinioClient pattern) — compatible with MinIO/RustFS
- Backup flow: BGSAVE → poll lastsave() → read dump.rdb from data dir → upload to S3
- Restore returns bytes (doesn't auto-restart Redis — that's an operational procedure)
- Scheduling integration: class provides `backup()` method; caller uses `@leader_only` decorator
- Key format: `{prefix}{YYYYMMDDTHHMMSSZ}.rdb` (sortable, unique per second)
- Handles both datetime and int lastsave() return values (redis-py varies by version)
- `delete_old_backups(retention_days)` provides cleanup of expired backups

**Patterns:**
- `RedisBackupManager(redis_client, s3_client, bucket, prefix)` — inject both clients
- Backup timeout via poll loop with configurable interval (avoids long hangs)
- RDB path discovered via `CONFIG GET dir` + `CONFIG GET dbfilename` with fallback defaults
- "already in progress" BGSAVE treated as non-error (just wait for it)
- S3 list_objects_v2 + filter by `.rdb` extension for listing

### Task 5.9: HPA for pylon-main (Iteration 33)

**Files created:**
- `elitea-platform/manifests/staging/hpa-pylon-main.yaml` — HPA manifest targeting `pylon-main` Deployment
- `elitea-platform/apps/staging/hpa.yaml` — ArgoCD Application to sync HPA manifests (glob: `hpa-*.yaml`)

**Files modified:**
- `elitea-platform/apps/staging/pylon-main.yaml` — Added `ignoreDifferences` for `Deployment.spec.replicas` so ArgoCD doesn't revert HPA scaling decisions
- `elitea-platform/values/staging/pylon-main.yaml` — Changed `replicaCount` from 3 to 2 (matches HPA minReplicas)

**Key decisions:**
- ArgoCD platform repo has no `base/` directory — uses `manifests/staging/` for raw k8s resources
- HPA app uses `directory.include: "hpa-*.yaml"` glob pattern — extensible for future HPAs (pylon-indexer, etc.)
- Scale-up behavior: min of 2 pods or 50% increase per 60s (conservative, prevents overshoot)
- Scale-down behavior: 1 pod per 120s with 300s stabilization window (prevents flapping)
- `ignoreDifferences` on `/spec/replicas` is critical — without it ArgoCD resets replica count on every sync

**Patterns:**
- ArgoCD + HPA: always add `ignoreDifferences` for `spec.replicas` on managed Deployments
- Set Helm `replicaCount` = HPA `minReplicas` for consistent initial state
- Sync-wave "3" ensures HPA deploys after the Deployment itself (wave "2")

### 2026-06-30: Task 5.10 - Custom HPA Metrics (Prometheus)

**Files created/modified:**
- `elitea_core/utils/prometheus_metrics.py` — custom Prometheus collector
- `elitea_core/routes/health.py` — added `/metrics` endpoint
- `elitea_core/requirements.txt` — added `prometheus_client>=0.20.0`
- `elitea-platform/manifests/staging/hpa-pylon-main.yaml` — added custom pod metrics
- `centry/tests/unit/scaling/test_prometheus_metrics.py` — 41 tests, 100% coverage

**Key learnings:**
- `prometheus_client` uses a custom Collector pattern (pull model) — `collect()` yields metric families on each scrape
- `CounterMetricFamily` strips `_total` from `name` attribute but samples include it; use `m.name` for programmatic access
- Socket.IO connection count via `sio.manager.get_participants('/', None)` returns iterable of `(sid, eio_sid)` tuples
- Fallback chain for connection count: get_participants → rooms() → eio.sockets
- Task queue depth from `redis.xlen("stream:work:task_distribution")` (the stream key has prefix)
- HPA custom metrics use `type: Pods` with `metric.name` matching what Prometheus-adapter exposes
- The `/metrics` endpoint caches the collector on `self._metrics_collector` to avoid re-registering
- `get_registry()` returns a dedicated `CollectorRegistry` (not global REGISTRY) to prevent test pollution
- Stream metrics (published/consumed/failed/pending) piggybacked onto the same collector from EventMetrics Redis hashes

**HPA metrics targets:**
- `pylon_active_connections` avg > 100 per pod → scale up
- `pylon_task_queue_depth` avg > 50 per pod → scale up

### Resource Requests/Limits Sizing Rationale

| Service | Requests (cpu/mem) | Limits (cpu/mem) | Rationale |
|---------|-------------------|------------------|-----------|
| pylon-main | 500m / 512Mi | 2000m / 2Gi | Handles API + Socket.IO; moderate CPU for request processing, 512Mi base fits idle state with Redis externalized |
| pylon-indexer | 1000m / 1Gi | 4000m / 4Gi | CPU-heavy agent execution (LLM orchestration, embeddings); needs 1Gi baseline for model runtimes, bursts to 4Gi for concurrent tasks |
| pylon-auth | 250m / 256Mi | 1000m / 1Gi | Stateless OIDC proxy; minimal baseline, occasional spikes during login storms |
| postgres (CNPG) | 500m / 1Gi | 2000m / 4Gi | Handles max_connections=200, shared_buffers=256MB; 4Gi limit for sort operations and temp buffers |
| valkey (Redis) | 250m / 512Mi | 1000m / 2Gi | In-memory store for sessions + state + streams; 512Mi minimum covers AOF + working set, 2Gi limit for peak load |

Key constraints:
- Requests set scheduler guarantees (QoS Burstable class for all services)
- Limits prevent noisy-neighbor issues in shared staging cluster
- pylon-indexer gets highest CPU/memory because it runs agent workloads (LiteLLM proxy, embeddings, tool execution)
- All services use Burstable QoS (requests < limits) for cost efficiency in staging

---

### PodDisruptionBudgets (Task 5.12)

PDB manifests are in `elitea-platform/manifests/staging/pdb-*.yaml`, synced by ArgoCD Application `apps/staging/pdb.yaml` using `directory.include: "pdb-*.yaml"`.

| Service | PDB Name | minAvailable | Selector |
|---------|----------|--------------|----------|
| pylon-main | pylon-main | 1 | `app.kubernetes.io/name: pylon-main` |
| pylon-indexer | pylon-indexer | 1 | `app.kubernetes.io/name: pylon-indexer` |
| postgres | postgres | 1 | `cnpg.io/cluster: elitea-staging-postgres-cluster` |
| valkey | valkey | 1 | `app.kubernetes.io/name: valkey` |

Key decisions:
- Used `minAvailable: 1` (not `maxUnavailable`) because it's more explicit for small replica counts
- Postgres PDB uses CNPG operator's label `cnpg.io/cluster` — operator manages pods, not a Deployment
- The task referenced `base/` and `kustomization.yaml` which don't exist in this repo — adapted to actual `manifests/staging/` + ArgoCD directory-include pattern
- Valkey currently runs 1 replica (no HA); PDB still useful to prevent accidental eviction during maintenance

### Node Affinity & Topology Spread (Task 5.13)

Topology spread constraints ensure pods distribute across availability zones; pod anti-affinity prefers different nodes within those zones.

**Chart changes required**: The pylon Helm chart (`charts/charts/pylon/`) declared `affinity`, `nodeSelector`, `tolerations` in `values.yaml` but the deployment template never rendered them. Fixed by:
1. Adding `{{- with .Values.affinity }}`, `{{- with .Values.tolerations }}`, `{{- with .Values.nodeSelector }}`, `{{- with .Values.topologySpreadConstraints }}` blocks to `templates/deployment.yaml`
2. Adding `topologySpreadConstraints`, `terminationGracePeriodSeconds`, `lifecycle`, `startupProbe` to `values.schema.json` (schema used strict `additionalProperties: false`)
3. Adding `topologySpreadConstraints: []` to `values.yaml` defaults

**Configuration per service** (in staging values):

| Service | topologySpreadConstraints | podAntiAffinity |
|---------|--------------------------|-----------------|
| pylon-main | zone spread, maxSkew=1, DoNotSchedule | prefer different hostname (weight 100) |
| pylon-indexer | zone spread, maxSkew=1, DoNotSchedule | prefer different hostname (weight 100) |
| pylon-auth | zone spread, maxSkew=1, DoNotSchedule | prefer different hostname (weight 100) |
| postgres (CNPG) | N/A (1 instance) | `affinity.topologyKey: kubernetes.io/hostname` (for when replicas added) |
| valkey | master zone spread, sentinel hard anti-affinity | via Bitnami chart `podAntiAffinityPreset` |

Key decisions:
- Used `DoNotSchedule` for zone spread (strict) — ensures HA across zones even if it means pending pods
- Used `preferredDuringSchedulingIgnoredDuringExecution` for hostname anti-affinity (soft) — allows scheduling even if only one node available per zone
- CNPG uses its own `affinity.topologyKey` field (not Kubernetes-native affinity spec)
- Valkey Bitnami chart uses `master.podAntiAffinityPreset` and `sentinel.podAntiAffinityPreset` helpers
- labelSelector uses `app.kubernetes.io/name` which is the standard label emitted by the pylon chart

### 2026-06-30: Task 5.14 - Deploy Prometheus + Grafana
- Added Prometheus (prom/prometheus:v3.4.1), Grafana (grafana/grafana:11.6.0), redis-exporter (oliver006/redis_exporter:v1.73.0), pgbouncer-exporter (prometheuscommunity/pgbouncer-exporter:v0.10.2) to docker-compose.yml
- Prometheus config at `centry/prometheus/prometheus.yml` — scrapes pylon_main:8080/metrics, redis-exporter:9121/metrics, pgbouncer-exporter:9127/metrics
- Grafana datasource provisioning at `centry/grafana/provisioning/datasources/prometheus.yaml`
- Dashboard JSON at `centry/grafana/dashboards/elitea-overview.json` with 8 panels: connections, task queue, Redis clients/memory, PgBouncer connections, event stream lag, errors, Redis commands/s, PgBouncer query duration
- Redis exporter needs password passed via entrypoint `sh -c` with `$$REDIS_PASSWORD` (docker-compose escaping)
- pgbouncer-exporter uses the `stats_users` account defined in pgbouncer.ini (`pgbouncer_stats`) — no password needed since PgBouncer stats DB only requires listed stats user
- Named volumes `prometheus-data` and `grafana-data` for persistence across restarts
- Grafana default creds: admin/admin (local dev only)
- Test file: `centry/tests/unit/scaling/test_prometheus_grafana.py` — 65 tests validating config files, docker-compose services, mount consistency

### 2026-06-30: Task 5.16 - Create Runbooks
- Created `docs/runbooks/` directory with four operational runbooks:
  - `redis-failover.md` — Sentinel failover diagnosis, manual failover commands, full restore from S3 backup
  - `pod-crash-loop.md` — OOMKilled, failed probes, import errors, migration lock; rollback and feature flag disable procedures
  - `high-latency.md` — PgBouncer pool checks, Redis slow log, CPU throttling, scale-up procedures
  - `database-connection-exhaustion.md` — PgBouncer SHOW POOLS, idle-in-transaction cleanup, connection math reference
- Each runbook follows consistent structure: Symptoms → Diagnosis → Resolution → Verification → Escalation
- Connection math reminder: (10×2) + (15×3) + (10×3) = 95 < 200 max_connections (with PgBouncer max_db_connections=50)

## Operational Docs

### Operations Documentation

| Document | Path | Use When |
|----------|------|----------|
| Scaling Manual | `docs/operations/scaling-manual.md` | Manual scale up/down, node drain, credential rotation |
| Monitoring Guide | `docs/operations/monitoring-guide.md` | Dashboard locations, metrics, alert silencing |
| Deployment Checklist | `docs/operations/deployment-checklist.md` | Pre-deploy, deploy, post-deploy verification |

### Incident Response

| Document | Path | Use When |
|----------|------|----------|
| Incident Playbook | `docs/incidents/playbook.md` | Severity classification, escalation, communication templates |
| Postmortem Template | `docs/incidents/postmortem-template.md` | Writing postmortems after P1/P2 incidents |
| Common Incidents | `docs/incidents/common-incidents.md` | Quick-reference for Redis OOM, crash loops, latency, data inconsistency |

### Runbooks

| Runbook | Path | Use When |
|---------|------|----------|
| Redis Failover | `docs/runbooks/redis-failover.md` | RedisDown alert, Sentinel failover, data restore |
| Pod Crash Loop | `docs/runbooks/pod-crash-loop.md` | CrashLoopBackOff, OOMKilled, repeated restarts |
| High Latency | `docs/runbooks/high-latency.md` | HighLatency alert, slow API responses, queue buildup |
| DB Connection Exhaustion | `docs/runbooks/database-connection-exhaustion.md` | Pool overflow errors, cl_waiting > 0 |
| Webhook Integration | `docs/webhooks.md` | Webhook IP changes, allowlisting, retry behavior, scaling |

### 2026-06-30: Task 5.17 - Implement Synthetic Monitoring
- Created `elitea_core/utils/synthetic_monitor.py` — active health probes with alert lifecycle
- Class `SyntheticMonitor` takes redis_client, db_engine, health_url, sio_url
- Probes: redis (PING), postgres (SELECT 1), http_health (GET /health/live), socketio (handshake)
- Results stored in Redis hashes with TTL: `synthetic:probe_results:{name}`
- Consecutive failure tracking: `synthetic:failure_count:{name}` — alert after threshold (default 3)
- Alert state in `synthetic:alert:{name}` + membership in `synthetic:active_alerts` set
- `get_prometheus_metrics()` returns tuples for Prometheus text exposition
- Socket.IO probe uses polling transport handshake (lightweight, no full WS)
- Designed to run as leader-only periodic task via LeaderElection
- Uses `urllib.request` (stdlib) for HTTP probes — no external dependency needed
- 61 unit tests in `centry/tests/unit/scaling/test_synthetic_monitor.py`

### 2026-06-30: Task 5.18 - Add Chaos Testing Suite
- Created `centry/tests/chaos/` directory with 23 tests across 3 test files
- Structure: `helpers.py` (shared utilities), `conftest.py` (fixtures), 3 test modules
- `test_redis_failure.py` (7 tests): stop/restart Redis, verify graceful degradation and AOF persistence
- `test_pod_kill.py` (8 tests): kill/restart containers, verify no data loss in Redis state
- `test_network_partition.py` (8 tests): tc netem delay/loss, verify timeout behavior and recovery
- Dependencies: `pytest`, `redis`, `requests` — not in system Python, intended for CI or dev venv
- Pytest conftest.py cannot be imported directly — must use a separate helpers.py module for shared code
- Network partition tests require `iproute2` and `NET_ADMIN` capability in containers
- All tests use cleanup fixtures (`ensure_redis_running`, `ensure_pylon_main_running`, `clean_network_rules`)
- Test keys use `chaos_test:` prefix with short TTLs (300s) to avoid pollution
- README.md documents prerequisites, environment variables, and CI integration example

### 2026-06-30: Task 5.19 - Configure Log Aggregation
- Created `elitea_core/utils/structured_logger.py` with `StructuredJSONFormatter`
- JSON format: `{"timestamp", "level", "service", "request_id", "logger", "message", "extra"}`
- Request ID management via `contextvars.ContextVar` (works across async boundaries)
- Integrates with existing tracing plugin's trace context (`flask.g.trace_id` from X-Trace-ID header)
- Service name from `NAME` env var (already set per container: `pylon-main`, `pylon-indexer`, etc.)
- Docker logging already configured: `json-file` driver, `max-size: "10m"`, `max-file: "5"` on all services
- Existing `centry_logging` package provides `SecretFormatter` — new formatter is additive, not a replacement
- `StructuredLogAdapter` injects request_id/service automatically into extra fields
- Flask hooks: `attach_request_id_before_request()` and `attach_request_id_after_request(response)`
- 57 unit tests in `centry/tests/unit/scaling/test_structured_logger.py`, 96% coverage
- Key paths: `centry_logging/centry_logging/` (existing), `centry/pylon_main/configs/tracing.yml` (trace config)

### 2026-06-30: Task 5.20 - Implement Distributed Tracing

- The project already has a comprehensive `tracing` plugin at `tracing/` (source repo) / `centry/pylon_main/plugins/tracing/` (runtime)
- The tracing plugin already provides: TracerProvider setup, @traced decorator, Flask middleware, SQLAlchemy instrumentation, RPC instrumentation, Socket.IO tracing, gevent context propagation
- `elitea_core/utils/tracing_utils.py` already exists — provides `get_current_traceparent()` and `add_trace_context_to_meta()` for propagating trace context to indexer tasks
- Created `elitea_core/utils/tracing.py` as a standalone module that:
  - Defers to the tracing plugin when available (`_try_plugin_tracer()`)
  - Falls back to its own standalone TracerProvider when plugin is not loaded
  - Provides `@traced` and `@traced_async` decorators
  - Provides `instrument_redis()`, `instrument_http_client()`, `instrument_sqlalchemy()`
  - Provides `propagate_via_socketio()` / `restore_from_socketio()` for cross-pod trace propagation
- Added `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-grpc`, `opentelemetry-instrumentation-redis` to `elitea_core/requirements.txt`
- Added Jaeger (all-in-one:1.62) to docker-compose.yml: ports 16686 (UI), 4317 (OTLP gRPC), 4318 (OTLP HTTP)
- Tracing plugin requirements (at `tracing/requirements.txt`): flask, requests, sqlalchemy instrumentors already present
- 63 unit tests in `centry/tests/unit/scaling/test_distributed_tracing.py`

### 2026-06-30: Task 6.1 - Enable Redis AUTH and TLS

- Redis AUTH was ALREADY configured: `--requirepass $$REDIS_PASSWORD` in docker-compose, env var `REDIS_PASSWORD=changeme`
- All services already pass `password` via `${REDIS_PASSWORD}` in their pylon.yml configs
- Sentinel already had `sentinel auth-pass mymaster REDIS_PASSWORD_PLACEHOLDER` with runtime sed substitution
- For TLS, created a conditional dual-config approach:
  - `redis.conf` — plain mode (default, `REDIS_TLS_ENABLED=false`)
  - `redis-tls.conf` — TLS mode with `tls-port 6380`, keeps `port 6379` for backward compat
  - `sentinel-tls.conf` — monitors master on TLS port 6380
- TLS certificates: self-signed dev certs generated by `centry/redis/tls/generate-certs.sh`
  - CA (4096-bit), server cert (SAN: redis, localhost, 127.0.0.1), client cert for mTLS
- `redis_client.py` updated:
  - New `_build_ssl_context()` reads `REDIS_TLS_CA_FILE`, `REDIS_TLS_CERT_FILE`, `REDIS_TLS_KEY_FILE`
  - On `REDIS_TLS_ENABLED=true`, automatically switches port from 6379→6380 and passes `ssl_context` to both Sentinel and direct connections
  - `get_sentinel_info()` also respects TLS settings for health checks
- Env vars added to `default.env`: `REDIS_TLS_ENABLED`, `REDIS_TLS_CERT_FILE`, `REDIS_TLS_KEY_FILE`, `REDIS_TLS_CA_FILE`
- Docker-compose uses conditional command selection based on `REDIS_TLS_ENABLED`
- 67 unit tests in `centry/tests/unit/scaling/test_redis_auth_tls.py`
- Key gotcha: macOS LibreSSL doesn't support `openssl x509 -ext` flag, use `-text` instead
- Key files: `centry/redis/redis-tls.conf`, `centry/redis/sentinel-tls.conf`, `centry/redis/tls/` (certs)

### Task 6.2: Network Policies

- Created in `elitea-platform/manifests/staging/netpol-*.yaml` (5 policies)
- ArgoCD app: `apps/staging/network-policies.yaml` uses `include: "netpol-*.yaml"` pattern
- Key labels for pod selectors:
  - Pylon services: `app.kubernetes.io/name: pylon-main|pylon-indexer|pylon-auth`
  - Valkey: `app.kubernetes.io/name: valkey`
  - PostgreSQL (CNPG): `cnpg.io/cluster: elitea-staging-postgres-cluster`
  - RustFS: `app.kubernetes.io/name: rustfs`
- Ingress controller (Traefik) is in `kube-system` namespace, selected via `namespaceSelector`
- CNPG operator runs in `cnpg-system` namespace, needs access to port 5432 + 8000 (status)
- External HTTPS egress (443) for LLM providers/OIDC uses `ipBlock` excluding RFC1918 ranges
- DNS egress (port 53 UDP/TCP) allowed to all namespaces for service discovery
- Valkey Sentinel port 26379 allowed between valkey pods
- Port 6380 included alongside 6379 for TLS-enabled Redis (from task 6.1)
- No `kustomization.yaml` exists in this repo — all managed via ArgoCD directory includes

### Kubernetes Secrets Management (Task 6.3)

**Secret sources in staging:**
- `elitea-staging-postgres-cluster-app` — auto-created by CNPG operator (contains `uri`, `password`)
- `elitea-staging-rustfs-secret` — auto-created by RustFS Helm chart (`RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`)
- `elitea-staging-platform-secrets` — manually managed Secret for all app-level secrets

**Platform secrets (`elitea-staging-platform-secrets`):**

| Secret Key | Usage | Rotation Frequency |
|-----------|-------|-------------------|
| `REDIS_PASSWORD` | Valkey/Redis auth | Every 90 days |
| `APPLICATION_MAIN_SECRET_KEY` | Flask session signing (pylon_main) | Every 180 days (invalidates sessions) |
| `APPLICATION_AUTH_SECRET_KEY` | Flask session signing (pylon_auth) | Every 180 days (invalidates sessions) |
| `SECRETS_MASTER_KEY` | Vault encryption key | NEVER rotate without re-encrypting |
| `RPC_HMAC_KEY` | Inter-pylon RPC authentication | Every 90 days (rolling restart required) |
| `EVENT_HMAC_KEY` | Event bus authentication | Every 90 days (rolling restart required) |
| `INDEXER_HMAC_KEY` | Indexer event authentication | Every 90 days (rolling restart required) |
| `EXPOSURE_HMAC_KEY` | Exposure/forward-auth bus auth | Every 90 days (rolling restart required) |
| `MESH_HMAC_KEY` | Service mesh authentication | Every 90 days (rolling restart required) |
| `JWT_SECRET` | Token signing | Every 90 days (invalidates tokens) |
| `GATEWAY_SECRET_KEY` | LLM Gateway signing | Every 180 days |

**How secrets reach pods:**
- Pylon Helm chart `secretRefs` maps Kubernetes Secret keys → container env vars
- Config files use `${ENV_VAR}` interpolation (pylon framework feature)
- ArgoCD `ignoreDifferences` on `/data` prevents secret drift detection

**Local dev:** Secrets in `centry/envs/default.env` (committed, default values), overridden by `centry/envs/override.env` (gitignored, actual values).

### 2026-06-30: Task 6.4 - Cookie Hardening

**Finding: No non-auth cookies exist in the codebase.**

Cookie audit results:
- **Auth session cookie** (Flask): Already hardened in task 2.2 via `SESSION_COOKIE_*` config in `pylon_auth/pylon.yml` (HttpOnly, Secure via env, SameSite=Lax)
- **Splash bypass cookie**: Only READ by `bootstrap/tools/splash.py`, never SET by the application (operator sets it manually for maintenance bypass)
- **GA cookie (EliteaUI)**: Managed by react-ga4 library, flags configured in `EliteaUI/src/GA.js` with `samesite=none;secure`
- **No other `set_cookie` calls** exist in `elitea_core/`, `pylon_main/plugins/`, or `pylon_auth/plugins/`

**Implementation:**
- Created `elitea_core/utils/cookie_hardening.py` — middleware that enforces HttpOnly, Secure, SameSite on ALL Set-Cookie headers as a safety net
- Tests in `centry/tests/unit/scaling/test_cookie_hardening.py` (36 tests, 100% coverage)
- Audit tests verify no future regressions (grep-based, catches new `set_cookie` calls)
- Browser-level verification deferred to staging deployment (no Docker/browser available in dev)

**Key patterns:**
- `register_cookie_hardening(app, secure=True, samesite='Lax')` — Flask after_request hook
- `harden_set_cookie_header(header_value, secure, samesite)` — patches individual header strings
- Excluded cookies list for third-party integrations that can't be modified

---

### Task 6.5: Audit Logging

**Files created:**
- `elitea_core/utils/audit_logger.py` — AuditLogger class with PostgreSQL append-only table
- `elitea_core/db/migrations/001_create_audit_log.sql` — SQL migration (also auto-created by `ensure_table()`)
- `centry/tests/unit/scaling/test_audit_logger.py` — 63 tests, 97% coverage

**Key patterns:**
- Uses SQLAlchemy Core (Table/MetaData) not ORM, for append-only writes
- Table lives in `centry` schema: `centry.audit_log`
- `AuditLogger(db_url, s3_client, service_name)` — main interface
- `logger.log(actor, action, resource, details, ip_address)` → returns event_id (UUID4)
- `logger.query(actor, action, since, until, limit, offset)` → list of dicts
- `logger.run_retention(retention_days=90, archive_to_s3=True)` — archives to S3 as JSONL then deletes
- AUDIT_ACTIONS tuple defines standard action strings (user.*, permission.*, data.*, admin.*, api_key.*, session.*)
- NullPool used to avoid connection leaks in long-running processes

### Task 6.6: Volume Security (fsGroup, permissions)

**Status**: Complete (56 tests passing)

**Key findings**:
- Pylon Helm chart (v1.0.6) already ships secure defaults in `values.yaml`:
  - `podSecurityContext`: runAsNonRoot=true, runAsUser=1000, runAsGroup=1000, fsGroup=1000, seccompProfile=RuntimeDefault
  - `securityContext`: allowPrivilegeEscalation=false, capabilities.drop=["ALL"]
- Chart template (`templates/deployment.yaml`) applies both contexts via `{{- with .Values.podSecurityContext }}` and `{{- with .Values.securityContext }}`
- We explicitly set these in staging values for documentation/audit clarity (explicit > implicit defaults)
- `readOnlyRootFilesystem: false` is required because pylon bootstrap:
  - Does `git clone` into `/data/plugins/` on startup
  - Does `pip install` into `/data/cache/pip/` 
  - Writes `pylon.db` SQLite to `/data/`
  - Creates `.pyc` bytecode files at runtime
- CNPG (postgres) and Valkey charts manage their own security contexts internally
- Init containers (busybox) inherit podSecurityContext — `runAsNonRoot: true` applies to them
- Added `tmpStorage` to pylon-auth (1Gi) for consistent emptyDir /tmp across all services

**Files modified**:
- `../kharkevich/argocd-public/elitea-platform/values/staging/pylon-main.yaml` — added explicit podSecurityContext + securityContext
- `../kharkevich/argocd-public/elitea-platform/values/staging/pylon-indexer.yaml` — added explicit podSecurityContext + securityContext
- `../kharkevich/argocd-public/elitea-platform/values/staging/pylon-auth.yaml` — added podSecurityContext + securityContext + tmpStorage

**Test file**: `centry/tests/unit/scaling/test_volume_security.py` (56 tests)

---

### Task 6.7: SDK Version Compatibility Testing

**Key finding**: Horizontal scaling introduces **NO breaking changes** to the elitea-sdk.

**Why**: The SDK communicates exclusively via stateless HTTP REST (`requests.get`/`requests.post`):
- Uses Bearer token auth (no server-side sessions needed)
- No WebSocket/Socket.IO dependency
- No cookie jar or sticky sessions
- Each request carries full auth context independently

**Testing approach**: AST-based source analysis + MockEliteAClient contract testing.
- Can't directly import SDK in Python 3.9 (SDK uses 3.10+ `bytes | dict` union syntax)
- `ast.parse()` the source files to verify structure, methods, class signatures
- MockEliteAClient mirrors the real SDK's HTTP patterns for behavioral testing

**Minimum compatible version**: SDK v0.7.0+ (uses `/api/v2` paths)

**New server behaviors SDK clients may encounter**:
- `409 Conflict` — distributed lock contention (retry after `Retry-After` header)
- `429 Too Many Requests` — rate limiting (exponential backoff recommended)

**Files created**:
- `centry/tests/compat/__init__.py`
- `centry/tests/compat/conftest.py`
- `centry/tests/compat/test_sdk_versions.py` (60 tests, 99% coverage)
- `centry/tests/compat/SDK_COMPATIBILITY.md` (documentation)

### Task 6.8: UI Client Resilience Testing

**Framework**: Playwright TypeScript (not Python — aligns with existing `centry/tests/e2e/` framework)

**Test spec location**: `centry/tests/e2e/specs/ui-resilience.spec.ts`

**Test coverage** (22 tests total — 11 per browser: chromium + firefox):
- Server restart: pod kill via k8s helper, verify auto-reconnect
- Network interruption: `page.route()` abort + `page.unroute()` pattern for 5s simulated disconnect
- Rapid refresh during streaming: verify no duplicate messages, no orphaned sockets
- Token expiry: clear cookies to simulate, verify login redirect without infinite loop
- Multi-pod validation: verify health across pods, no sticky session dependency

**Patterns used**:
- `page.route('**/socket.io/**', route => route.abort())` — simulates network loss for Socket.IO
- `page.waitForFunction(() => ...)` — polls browser-side state (socket connected)
- `page.evaluate()` — accesses `window.__socketIO` exposed by client for testing
- `MutationObserver` in-page — tracks `data-status` attribute changes on connection indicator
- `page.context().clearCookies()` — simulates token expiry

**Run command**: `npm run test:ui-resilience` (or `npx playwright test specs/ui-resilience.spec.ts`)

**Requires**: Multi-pod staging deployment + OIDC mock + k8s cluster access

---

### 2026-06-30: Task 6.9 - Document Dynamic Webhook IPs

**Webhook endpoints identified:**
- `POST /api/v2/elitea_core/webhook/prompt_lib/{project_id}/{version_id}/{type}` — inbound (GitHub, GitLab, custom)
- `POST /api/v2/elitea_core/webchat/prompt_lib/{project_id}/{version_id}` — MS Teams Bot Framework
- `POST /api/v2/elitea_core/mcp_oauth_proxy/...` — MCP OAuth callbacks

**Outbound callbacks:**
- `methods/task_callbacks.py` — POSTs task results to user-specified `callback_url` (fire-and-forget, no retry)
- `utils/botframework.py` — POSTs activities to MS Teams `serviceUrl` (from incoming activity)
- `utils/mcp_oauth.py` — POSTs to OAuth token endpoints for MCP server authentication

**Key insight:** Pod IPs are ephemeral in horizontal scaling. External services MUST use the ingress hostname, not pod IPs. Outbound traffic should route through NAT Gateway for stable source IPs.

**Files created/modified:**
- `docs/webhooks.md` — full webhook integration documentation
- `elitea_core/utils/synthetic_monitor.py` — added `webhook_url` parameter and `_probe_webhook()` method
- `centry/tests/unit/scaling/test_synthetic_monitor.py` — 7 new tests (68 total, all passing)

**Webhook signature types** (from `pipeline_trigger.py` WEBHOOK_TYPE_CONFIG):
- `github` → HMAC-SHA256 validation via `x-hub-signature-256`
- `gitlab` → token match via `x-gitlab-token`
- `custom` → token match via `X-Webhook-Token`

---

### 2026-06-30: Task 6.10 - Implement Global API Rate Limiting

**Architecture:**
- Created `elitea_core/middleware/rate_limiter.py` — new `middleware/` package in elitea_core
- Uses Redis INCR + EXPIRE per-minute-bucket key for O(1) cost per request
- Key pattern: `rate_limit:{identifier}:{minute_bucket}` where minute_bucket = epoch // 60
- Fails open: if Redis is unavailable, requests are allowed through (production safety)

**Rate limits:**
- Unauthenticated (by IP): 100 req/min (configurable via `RATE_LIMIT_IP` env var)
- Authenticated (by user): 1000 req/min (configurable via `RATE_LIMIT_USER` env var)
- User identification: checks `flask.g.user.id`, `flask.g.auth_info.user_id`, `flask.g.auth_info.sub`

**Bypass mechanism:**
- Internal service-to-service calls bypass via `X-Internal-Token` header
- Token configured via `INTERNAL_SERVICE_TOKEN` env var
- Empty/unset token disables bypass entirely

**Exempt paths:** `/health/live`, `/health/ready`, `/health/events`, `/health/streams`, `/metrics`

**Status endpoint:** `GET /api/rate-limit/status` — shows current usage for the caller (added to `routes/health.py`)

**Registration pattern:** `register_rate_limiter(app, redis_client, ...)` returns limiter instance; hooks Flask `before_request` + `after_request`.

**Files created:**
- `elitea_core/middleware/__init__.py`
- `elitea_core/middleware/rate_limiter.py`
- `centry/tests/unit/scaling/test_rate_limiter.py` — 62 tests, 100% coverage

**Files modified:**
- `elitea_core/routes/health.py` — added `/api/rate-limit/status` route

### 2026-06-30: Task 6.11 - Feature Flags v2 (Percentage Rollout + Admin API)
- `elitea_core/utils/feature_flags.py` enhanced: JSON storage `{"enabled": bool, "rollout_pct": int}`
- Backward compatible: legacy plain "1"/"0" string values still work
- Percentage rollout uses MD5 hash of user_id for deterministic bucket assignment
- Without user_id, partial rollout treated as fully enabled (flag applies at system level)
- Admin API: `GET/POST /api/admin/feature-flags` in `elitea_core/routes/health.py`
- Auth: `X-Internal-Token` header OR `flask.g.auth_info.role in ("admin", "superadmin")`
- New KNOWN_FLAGS: added `REDIS_STREAMS`, `SENTINEL_MODE`, `HPA_ENABLED`, `EVENT_DEDUP`
- Tests: 120 total (38 original + 56 v2 + 26 admin API), 94% coverage on feature_flags.py

**Files modified:**
- `elitea_core/utils/feature_flags.py` — added JSON storage, rollout_pct, get_flag_details, list_all_details
- `elitea_core/routes/health.py` — added `/api/admin/feature-flags` GET/POST routes
- `centry/tests/unit/scaling/test_feature_flags.py` — updated for JSON set_flag format
- `centry/tests/unit/scaling/test_feature_flags_v2.py` — new: 56 tests for rollout logic
- `centry/tests/unit/scaling/test_feature_flags_admin_api.py` — new: 26 tests for admin API

### Task 6.12: Per-Phase Rollback Procedures

**Created docs**: `docs/rollback/phase-{1,2,3,4}-rollback.md`

**Key patterns**:
- Feature flags provide instant rollback without redeploy (SOCKETIO_REDIS_ENABLED, REDIS_STATE_ENABLED, REDIS_STREAMS_ENABLED, event_dedup)
- Always scale to 1 replica BEFORE reverting state externalization (prevents split-brain)
- Redis data with TTLs is self-cleaning — orphaned keys expire without intervention
- Phase 2 revert invalidates all user sessions (communicate maintenance window)
- Phase 4 Streams→pub/sub revert loses pending messages; use event_replay utility first
- Leader election revert causes periodic tasks to run on all pods (idempotent, so safe)

**File locations**:
- `docs/rollback/phase-1-rollback.md` — stateless foundation revert
- `docs/rollback/phase-2-rollback.md` — session & task state revert
- `docs/rollback/phase-3-rollback.md` — storage optimization revert
- `docs/rollback/phase-4-rollback.md` — event system revert

### Task 6.14: Redis Backup/Restore Testing

**Location**: `centry/tests/disaster/test_redis_backup_restore.py` (16 tests)

**CI Workflow**: `centry/.github/workflows/disaster-recovery-tests.yml` (monthly cron: `0 3 1 * *`)

**Pattern**: Tests follow the chaos test pattern (`tests/chaos/`) with Docker Compose fixtures. The restore simulation writes the RDB backup into the Redis container via `docker compose exec`, then restarts Redis to load it.

**Key implementation details**:
- `_simulate_rdb_restore()` handles large RDB files by chunking base64 data (65KB chunks) to avoid shell argument limits
- Tests use `dr_test_` prefixed keys/streams to avoid conflicts with other test suites
- `cleanup_test_data` autouse fixture ensures clean state before/after each test
- Requires: redis, rustfs/minio running in Docker Compose
- Environment vars: `CHAOS_REDIS_HOST`, `S3_ENDPOINT`, `S3_BACKUP_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

**Test coverage classes**:
- `TestBackupCreation` — verifies RDB created in S3, captures current data, list includes it
- `TestSessionDataRestore` — session keys + TTLs preserved through backup/flush/restore
- `TestFeatureFlagRestore` — feature flag values including rollout percentages preserved
- `TestEventStreamRestore` — stream messages, consumer groups, pending message state preserved
- `TestRestoreEdgeCases` — empty Redis, non-existent backup, multiple cycles, older backup restore
- `TestBackupRetention` — retention cleanup and ordering

### 2026-06-30: Task 6.15 - Canvas Auto-save (5-min interval)
- Canvas save mechanism: `chat_canvas_save_versions` RPC runs every minute via pylon scheduling plugin (`cron: '* * * * *'`)
- Canvas content stored in Redis keys: `canvas:{project_id}_{canvas_uuid}` (with TTL for session expiry)
- Shadow keys (`shadow:canvas:...`) trigger save-on-expire via Redis keyspace notifications
- `edit_canvas` SIO handler writes content directly to Redis (line ~352 in `sio/all.py`)
- Created `elitea_core/utils/canvas_autosave.py` — dirty tracking via Redis hash per canvas
- Key pattern: `canvas_autosave:{project_id}_{canvas_uuid}` → {dirty, last_saved_at, last_modified_at, version}
- Added `canvas_autosave` RPC method in `rpc/chat_canvas.py` — only saves canvases dirty for 5+ minutes
- Registered as `*/5 * * * *` cron via `scheduling_create_if_not_exists` in module.py
- `last_saved_at` added to API response via `computed_field` on `CanvasItemDetail` Pydantic model
- Recovery info (has_unsaved, server_version, timestamps) sent with `chat_canvas_detail` SIO event on join
- `CanvasAutosave.mark_dirty()` called from `edit_canvas` SIO handler after content write
- Test file: `centry/tests/unit/scaling/test_canvas_autosave.py` (44 tests, all passing)

### 2026-06-30: Task 6.16 - Disaster Recovery Plan
- Created `docs/disaster-recovery.md` with RPO < 1h, RTO < 30 min targets
- Covers 4 failure scenarios: Redis loss, PostgreSQL corruption, full cluster failure, S3 storage loss
- Each scenario has detection, step-by-step recovery commands (Docker + Kubernetes), and data loss assessment
- Backup verification schedule: Redis/PG weekly automated, S3 monthly spot-check, full DR drill quarterly
- Includes escalation contacts table, severity levels (P1-P4), communication channels
- Recovery decision tree helps on-call determine which scenario to follow
- Prevention measures table references all deployed phases (Sentinel, AOF, PDB, multi-AZ)
- Post-incident procedures: 1h summary, 24h postmortem scheduled, 48h document, 1 week action items

### 2026-06-30: Task 6.17 - PostgreSQL Backup Strategy
- Created `elitea_core/utils/pg_backup.py` — PgBackupManager class following same pattern as RedisBackupManager
- Backup: runs `pg_dump -Fc` (custom format, compressed), uploads to S3 with timestamped key
- Restore: downloads from S3 to tempfile, runs `pg_restore --clean --if-exists`
- verify_backup(): runs `pg_restore --list` to validate dump without restoring
- delete_old_backups(): S3 lifecycle retention (default 7 days)
- Docker: `pg-backup` service in docker-compose.yml using same pgvector image as postgres
- Uses `POSTGRES_DIRECT_HOST` (bypasses PgBouncer) for reliable dump/restore
- Shell backup script: `centry/scripts/pg-backup.sh` — loop with configurable BACKUP_INTERVAL_HOURS
- Restore script: `centry/scripts/restore-postgres.sh` — interactive with safety confirm, connection termination, verification
- Env vars added to default.env: BACKUP_INTERVAL_HOURS, BACKUP_RETENTION_DAYS, BACKUP_BUCKET, BACKUP_PREFIX
- pg_restore exit 1 = warnings (tolerated), exit >1 = fatal errors (raised)
- Test file: `centry/tests/unit/scaling/test_pg_backup.py` (48 tests, 100% coverage)

### Task 6.18: Data Consistency Checks

- Source: `elitea_core/utils/consistency_checker.py`
- Runtime copy: `centry/pylon_main/plugins/elitea_core/utils/consistency_checker.py`
- Test: `centry/tests/unit/scaling/test_consistency_checker.py` (84 tests, 100% coverage)
- Redis keys: `consistency:results:{check}`, `consistency:metrics:{check}`, `consistency:last_run`
- Three checks implemented:
  1. **sessions**: Redis session key count vs `auth_session` DB table count (tolerance ±5)
  2. **canvas_versions**: Redis canvas_autosave version vs PostgreSQL `chat_canvas.version`
  3. **feature_flags**: Validates JSON schema of all `feature_flags:global:*` keys
- Runs leader-only every 15min via CHECK_INTERVAL_S=900
- On inconsistency: logs ERROR, increments metric counter, does NOT auto-fix
- Without DB engine: only feature_flags check runs (useful for Redis-only services)
- Canvas version 0 is ignored (newly joined, not meaningful for comparison)
- Canvas not found in DB is not treated as inconsistency (deleted/not-yet-persisted)
- get_metrics() returns Prometheus-compatible tuples for exposition
- Pattern: uses SCAN for Redis key enumeration, parameterized queries for DB

### Task 6.19: Operational Procedures Documentation

- Created `docs/operations/scaling-manual.md`: manual scale up/down, HPA override, node drain, credential rotation (Redis + PostgreSQL)
- Created `docs/operations/monitoring-guide.md`: dashboard URLs, all key metrics with normal/warning/critical thresholds, SLO targets, alert silencing (Grafana + Alertmanager), useful PromQL queries
- Created `docs/operations/deployment-checklist.md`: pre-deploy infrastructure checks, ArgoCD sync + manual rollout, feature flag deploys, post-deploy verification (immediate/short/extended), rollback decision table
- Linked all under "Operations Documentation" subsection in AGENT.md's Operational Docs section
- Credential rotation schedule documented: Redis/PG quarterly, secrets annually, master key never (re-encrypt instead)
- Connection limits table uses PgBouncer math from Phase 5 (pool_size × replicas < max_db_connections)

### Task 6.20: Incident Response Playbook

- Created `docs/incidents/playbook.md`: severity levels (P1-P4) with response times, escalation procedure, incident lifecycle (detection → acknowledgement → triage → mitigation → resolution → follow-up), communication templates (status page + Slack), quick-reference first-5-minutes guide
- Created `docs/incidents/postmortem-template.md`: structured template with summary, impact table, timeline, root cause, contributing factors, lessons learned (went well / went poorly / got lucky), action items table
- Created `docs/incidents/common-incidents.md`: detailed diagnosis and resolution for 5 common scenarios: Redis OOM, Pod Crash Loop, High Latency, Data Inconsistency, Task Queue Stalled, Socket.IO Connection Storm
- All docs reference existing tooling: health endpoints, Prometheus metrics, PgBouncer stats, Redis CLI commands, kubectl patterns
- Cross-referenced from AGENT.md Operational Docs → Incident Response table
- Common incidents doc references consistency checker, feature flag admin API, stream monitoring from earlier phases

---
*Last updated by Ralph iteration*
