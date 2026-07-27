# Production runtime cross-process system test

## Existing Centry index reliability harness

`TestExistingComposeIndexReliability` is an opt-in, state-changing black-box
test for the already-running Centry hybrid runtime profile. It does not start a
second PostgreSQL or Redis and does not read `envs/override.env` itself. Docker
Compose resolves the existing service environment, while the test supplies
only paths, a non-secret start request, and a short-lived authenticated browser
cookie from owner-only local files.

The test fails closed unless there are zero active `index.ingest.v1`
executions, zero index-stream entries, zero delivery-index mappings, and zero
pending deliveries. It then runs two uniquely named indexes:

1. It stops the real `elitea-indexer-worker`, admits through the public HTTPS
   start route, and uses the worker's existing Redis ACL inside the Redis
   container to fetch and age one signed reference as
   `reliability-crashed-consumer`. This synthetic consumer is the only
   transport test double. Starting the real worker must reclaim that pending
   reference, create a PostgreSQL claim, settle durably, publish replay events,
   and retire the Redis reference.
2. With the worker stopped, it admits a second execution, opens public SSE,
   calls the public Stop route twice, and requires idempotent `204` responses,
   durable `CANCELLED` state with no worker claim, a replay event, and empty
   Redis control state.

Both requests inject a random, non-secret content-plane canary. The signed
Redis reference and public SSE data must not contain it. The test never prints
the cookie, Redis ACL passwords, signed envelope, input bundle, or SSE data.

Create a request file containing only caller-safe references and ordinary tool
parameters. Replace `123` with one visible toolkit Configuration ID; do not put
provider credentials or Configuration settings in this file:

```json
{
  "toolkit_config": {"toolkit_id": 123},
  "tool_name": "index_data",
  "tool_params": {
    "index_name": "replaced-by-the-harness",
    "repository": "owner/small-fixture-repository"
  },
  "llm_model": null,
  "llm_settings": {}
}
```

Store the raw `Cookie` request-header value from an authenticated local Form
session in a private file, for example `elitea_session=v1...`; do not include a
`Cookie:` prefix. Run from the `elitea-platform` repository root:

```bash
chmod 600 /absolute/private/path/index-cookie

ELITEA_INDEX_RELIABILITY_SYSTEM_TEST=1 \
ELITEA_CENTRY_DIR=/absolute/path/to/centry \
ELITEA_AUTH_POV_RUNTIME_DIR=/absolute/private/path/auth-pov-runtime \
ELITEA_INDEX_TEST_COOKIE_FILE=/absolute/private/path/index-cookie \
ELITEA_INDEX_TEST_REQUEST_FILE=/absolute/path/index-request.json \
ELITEA_INDEX_TEST_PROJECT_ID=1 \
go test -count=1 -v ./services/elitea-main/tests/system \
  -run '^TestExistingComposeIndexReliability$'
```

The default public origin is `https://localhost:18443`; override it with
`ELITEA_INDEX_TEST_BASE_URL` only when it is still an HTTPS origin.
`ELITEA_INDEX_TEST_TIMEOUT` may be set from `1m` through `15m` (default `5m`).
The runtime profile must already be bootstrapped and running with the checked-in
index route, stream, group, certificates, and ACL files. The authenticated
actor needs the route permissions. A current active PAT is additionally
required to cross the worker's runtime-context bridge into SDK/provider work;
without it the reclaim slice may validly prove a durable `FAILED` settlement.

Boundary classification:

| Boundary | Evidence in this harness |
| --- | --- |
| Public start / Stop / SSE over HTTPS | Real gateway, TLS, authentication, routing, Main handlers, and durable SSE replay |
| PostgreSQL | Real existing database, migrations, admission/outbox/claim/settlement/replay rows |
| Redis | Real existing TLS/ACL Redis, stream, consumer group, PEL, delivery-index hash, worker reclaim, and retirement |
| Worker control/content/output | Real restarted worker and its mTLS gRPC plus HTTPS content path; a PostgreSQL claim proves it crossed control admission |
| Crash window | Test double: one synthetic Redis consumer fetches and ages a real signed reference but never calls Main or executes SDK code |
| Progress safety | Deterministic non-secret canary injected into the private input and asserted absent from Redis references and public SSE |
| Provider, source system, and PgVector effects | External and deliberately unasserted |

`SUCCEEDED` and `FAILED` are both valid terminal results for the reclaim slice:
the test is proving cross-process delivery and settlement reliability, not a
provider contract. A failure such as an unavailable actor PAT or provider is
still visible in durable state without being misreported as Redis failure.
Claim provider or PgVector coverage only after supplying a deterministic
provider/source fixture through the existing SDK boundary and separately
checking its expected database effect. The current compose has no such
credential-free deterministic provider fixture, and the harness does not add a
production injection route or weaken the recorded PgVector TLS/DDL gaps.

The ordinary compile/unit check remains non-mutating:

```bash
go test ./services/elitea-main/tests/system \
  -run 'TestDecodeNonSecret|TestPrepareIndex'
```

## Self-contained configuration validation topology

`TestProductionRuntimeCrossProcessSystem` starts real PostgreSQL 16 and two
Redis 7 containers, then independently starts the production `elitea-main`
binary and four `elitea-worker serve` processes. Three workers independently
prove fail-closed command-signature, durable workload-identity binding, and
mTLS trust-root enforcement: each leaves the command unclaimed and
unacknowledged. The authorized worker then reclaims the same pending reference
and completes the public submit, Redis reference delivery, mTLS gRPC claim,
HTTP/2 content fetch, SDK business handler, mTLS gRPC output/settlement, atomic
stable-delivery-bound `XACK` + `XDEL` + delivery-index `HDEL`, and authorized
SSE replay.

Against the same TLS/ACL broker, the test also verifies that worker credentials
cannot `XADD`, `HSET`, or `PUBLISH`, while producer credentials cannot
`XREADGROUP`, `XACK`, or `XDEL`. Both roles are restricted to the command
stream and its delivery-index key.

Run it explicitly; the ordinary unit/component suites do not start Docker:

```bash
ELITEA_RUNTIME_SYSTEM_TEST=1 \
ELITEA_SYSTEM_PYTHON=/absolute/path/to/python3.12 \
go test -count=1 -v ./services/elitea-main/tests/system \
  -run '^TestProductionRuntimeCrossProcessSystem$'
```

The selected Python environment must contain the worker dependencies, notably
the pinned SDK, `redis`, `h2`, `grpcio`, `httpx`, `pydantic`, and
`cryptography`. `ELITEA_SYSTEM_PYTHONPATH` may point at an additional local
dependency directory.

`ELITEA_SYSTEM_SDK_PATH` may point at the exact admitted Elitea SDK root. Use
it when a sibling `elitea-sdk` checkout exists but has advanced beyond the
worker's pinned revision; the worker intentionally fails closed on a package-
tree digest mismatch.

This is system/end-to-end evidence for the small credential-free configuration
validation slice. It is not a load, soak, penetration, failover, certificate
rotation, or production-scale issue #5681 test. The current input-content
profile is intentionally capped at 256 KiB; large file/image streaming needs
its artifact path before that broader scenario can be claimed closed by a
system test.

## Index embedding binding Go-to-Python gate

`TestIndexEmbeddingBindingMainWorkerCrossProcess` is a non-deployment,
cross-process compatibility gate for the index capability-version transition.
The Go process uses the production authoritative-input resolver, embedding
binding resolver and Ed25519 index command producer. It proves that an exact
default `(model_name, model_project_id)` tuple owned by the shared public
project remains distinct from the current LiteLLM proxy's observed
project-first, public-fallback and raw-fallback routes.

A separate Python process uses the production worker delivery processor and
Ed25519 authenticator. It rejects a correctly signed stale
`index.ingest.v1` capability version `1` before the worker calls Main's claim
service, accepts version `2` through that pre-claim boundary, and validates the
claim-scoped binding with the worker's production schema mapper. The signed
control message carries only the immutable binding reference and digest; model
names, credential references, deployment details and endpoints remain absent.

Run it against the worker's exactly pinned SDK:

```bash
ELITEA_INDEX_BINDING_CROSS_PROCESS_TEST=1 \
ELITEA_SYSTEM_PYTHON=/absolute/path/to/python3.12 \
ELITEA_SYSTEM_SDK_PATH=/absolute/path/to/elitea-sdk-at-the-pinned-revision \
go test -count=1 -v ./services/elitea-main/tests/system \
  -run '^TestIndexEmbeddingBindingMainWorkerCrossProcess$'
```

This gate does not contact PostgreSQL, LiteLLM, Redis, PgVector or a provider.
Those service-backed boundaries retain their dedicated integration tests; this
test specifically proves the signed Main-to-worker authorization, version and
reference-only language boundary.
