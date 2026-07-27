# Issue #5681 production-scale indexing gate

This is the opt-in acceptance gate for the production failure where large
Confluence image-analysis traffic shared Redis with control traffic. The
protected PostgreSQL bundle contains only bounded configuration references.
The 62 MiB corpus and all model traffic stay on HTTP:

```text
authenticated UI contract
  -> elitea-main RBAC and tenant admission
  -> PostgreSQL bundle and outbox
  -> one signed Redis reference
  -> standalone Python worker claim/retry
  -> Confluence HTTP
  -> external LiteLLM HTTP
  -> fixture model provider HTTP
  -> mTLS output frames
  -> PostgreSQL settlement/replay
  -> authenticated public SSE and index-meta APIs
```

The deterministic source is ten 3 MiB PNG attachments plus one 32 MiB PNG:
exactly 62 MiB. The pinned current SDK analyzes every image twice, so the exact
baseline is 124 MiB of completed source responses and 22 vision requests. The
normalized large image must create a model request over 32 MiB.

## Acceptance evidence

The gate asserts:

- spoofed forwarded identity and a real authenticated actor lacking the current
  permissions cannot start indexing or read SSE;
- the allowed actor can access a second existing project/toolkit but cannot
  replay the first project's execution through it;
- Main, worker, external LiteLLM, platform checkout, and SDK are attested by
  immutable revisions, Docker image IDs, image revision labels, and SDK tree;
- the selected toolkit is the requested project's current Confluence toolkit;
- the signed envelope and command pass the strict protobuf scanner, reject
  unknown/duplicate fields, and carry only `index.ingest.v1` references;
- the bundle manifest is below 64 KiB, the exact two-to-six command references
  match the bundle entry count, and every entry is at most 256 KiB;
- Redis contains one `signed_envelope` below 48 KiB; its delivery-index field
  equals the command idempotency key and maps to that one stream entry;
- a real Redis PEL crash/reclaim occurs, then the synthetic consumer, pending
  entry, stream entry, and delivery mapping are all removed;
- the exact workload identity/session, producer, claim, fence, output,
  settlement, and contiguous replay sequences join durably;
- public SSE emits canonical current 13-field NodeEvent JSON in the exact
  start/thinking/in-progress/completed/end/terminal order with the browser
  stream/message/SIO correlation unchanged;
- SSE/replay excludes canaries, source digests, credentials, URLs,
  configuration markers, base64 and source/model payloads;
- source receipts prove every image twice, 124 MiB, 22 authenticated vision
  calls, embedding calls, the external LiteLLM attestation, and no rejected
  source/model/proxy request;
- the public index-meta API proves one non-stale completed PgVector collection
  with the exact indexed/updated counts, and cleanup deletes it through the
  public API;
- a terminal worker restart creates no duplicate claim, output, settlement,
  replay, source fetch, or model call;
- Stop before claim is idempotent and remains cancelled with zero authority or
  data-plane effects after the worker restarts.

## Dedicated environment

Never point this test at shared development, staging, or production state. It
requires a disposable Compose namespace named `elitea-5681-*`, a dedicated
product project and project-specific PgVector database, an empty runtime
execution table, and empty dedicated Redis index stream/group state.

Provision through current product APIs/UI:

1. A Confluence credential whose URL is
   `http://host.docker.internal:<fixture-port>`.
2. A Confluence toolkit in the dedicated test project using that credential,
   project-specific PgVector, and fixture vision/embedding models.
3. A separately running external LiteLLM whose model routes target the
   fixture's OpenAI-compatible `/v1` endpoints. It must preserve the exact
   project and bearer headers and inject a fixture-only
   `X-Elitea-5681-Proxy-Attestation` value. The fixture stores only SHA-256
   fingerprints, so direct worker bypass is rejected.
4. An active PAT for the allowed browser actor.
5. Two owner-only Cookie files: one actor allowed to index/read/delete and one
   authenticated actor denied those permissions. Also provide a second existing
   project/toolkit accessible to the allowed actor.
6. Main and worker images labelled
   `org.opencontainers.image.revision=<platform SHA>`. The external LiteLLM
   image must carry the same label with its own supplied revision.
7. Normal TLS certificates, Redis ACLs, runtime routes, and the standalone
   `elitea-indexer-worker`.

The request file is non-secret and uses the current UI body:

```json
{
  "toolkit_config": {"toolkit_id": 123},
  "tool_name": "index_data",
  "tool_params": {
    "index_name": "replaced-by-the-gate",
    "clean_index": false,
    "content_format": "view",
    "include_attachments": true,
    "include_comments": false,
    "include_restricted_content": true,
    "keep_markdown_format": true,
    "bins_with_llm": true,
    "max_pages": 1,
    "limit": 1,
    "meta_update_interval": 0
  },
  "llm_model": null,
  "llm_settings": {}
}
```

Example operator invocation:

```bash
ELITEA_CENTRY_DIR=/absolute/path/to/centry \
ELITEA_AUTH_POV_RUNTIME_DIR=/absolute/private/path/auth-pov-runtime \
ELITEA_INDEX_TEST_COOKIE_FILE=/absolute/private/path/allowed-cookie \
ELITEA_INDEX_5681_DENIED_COOKIE_FILE=/absolute/private/path/denied-cookie \
ELITEA_INDEX_TEST_REQUEST_FILE=/absolute/path/index-5681-request.json \
ELITEA_INDEX_TEST_PROJECT_ID=1 \
ELITEA_INDEX_5681_SECOND_PROJECT_ID=2 \
ELITEA_INDEX_5681_SECOND_TOOLKIT_ID=456 \
ELITEA_INDEX_5681_FIXTURE_PORT=18681 \
ELITEA_INDEX_5681_COMPOSE_PROJECT=elitea-5681-local \
ELITEA_INDEX_5681_WORKLOAD_IDENTITY=spiffe://elitea/runtime/indexer-worker \
ELITEA_INDEX_5681_SOURCE_AUTH_SHA256=<64-hex> \
ELITEA_INDEX_5681_MODEL_AUTH_SHA256=<64-hex> \
ELITEA_INDEX_5681_LITELLM_ATTESTATION_SHA256=<64-hex> \
ELITEA_INDEX_5681_PLATFORM_SHA=<40-hex> \
ELITEA_INDEX_5681_MAIN_IMAGE_ID=sha256:<64-hex> \
ELITEA_INDEX_5681_WORKER_IMAGE_ID=sha256:<64-hex> \
ELITEA_INDEX_5681_LITELLM_IMAGE_ID=sha256:<64-hex> \
ELITEA_INDEX_5681_LITELLM_SERVICE=elitea-litellm \
ELITEA_INDEX_5681_LITELLM_REVISION=<40-hex> \
ELITEA_INDEX_5681_SDK_REVISION=48c51a16634a9924f6c5d5313c3bacedb0b5b56b \
services/elitea-main/tests/reliability/index_5681/run.sh
```

The three authorization values are fingerprints of exact HTTP header values,
not the values themselves. Do not put the original headers in shell history or
tracked files.

The wrapper returns 2 for missing prerequisites, 1 for a failed contract, and
0 only for a pass. It gives the test context 12 minutes, `go test` 14 minutes,
and enforces an outer 15-minute process-group deadline. It restores the worker
only when it was initially running. API bodies, Compose stderr, signed
envelopes, Cookies/PATs, and source/model payloads are not printed.

## Operator-only trust boundary

There is deliberately no GitHub Actions workflow for this state-changing gate.
Never execute an arbitrary pull-request or selected ref on a
credential-bearing self-hosted runner. Run only a reviewed immutable checkout
in the disposable environment above. A pass is evidence only for the reported
checkout SHA, exact image IDs/revision labels, SDK lock, actors, tenant,
toolkit, and external LiteLLM/PgVector resources used by that run.

This is not a soak, multi-worker load, certificate-rotation,
external-Confluence, or external-model-provider test. Those remain separate
release gates.
