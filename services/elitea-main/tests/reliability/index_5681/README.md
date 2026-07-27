# Issue #5681 production-scale indexing gate

This directory contains the opt-in acceptance gate for the production failure
where large Confluence image-analysis traffic shared Redis with control traffic.
It does not put 62 MiB into an execution input bundle. That would contradict the
runtime contract and the current application: the protected PostgreSQL bundle
contains only bounded toolkit/model/tool-parameter configuration, while the SDK
fetches Confluence content and calls LiteLLM over HTTP.

The gate instead proves this complete path:

```text
authenticated UI contract
  -> elitea-main RBAC and tenant-scoped admission
  -> bounded protected input bundle + PostgreSQL outbox
  -> one bounded signed reference in real Redis Streams
  -> standalone Python worker claim and retry
  -> Confluence and LiteLLM HTTP data plane
  -> mTLS output frames
  -> PostgreSQL settlement and durable replay
  -> authenticated public SSE
```

The deterministic source corpus is ten 3 MiB PNG attachments plus one 32 MiB
PNG attachment: exactly 62 MiB. The current SDK intentionally analyzes every
Confluence image twice with different prompts (parent augmentation and
dependent attachment extraction). Therefore the exact current-baseline evidence
is 124 MiB of completed source responses and 22 vision requests. The large
vision request must exceed 32 MiB after PNG normalization and base64 encoding.

## What the gate asserts

- spoofed forwarded identity cannot start indexing or read SSE, while the public
  start, Stop, and SSE routes use an authenticated browser session;
- authenticated SSE cannot replay an execution through another project ID;
- the admitted tenant, resource project, and projection project remain the same,
  and the real claim records a SPIFFE workload identity and workload session;
- the selected toolkit belongs to the requested project and is `confluence`;
- Main persists an input manifest below 64 KiB and no more than five 256 KiB
  configuration entries;
- the prepared outbox envelope and sole Redis `signed_envelope` field remain
  below 48 KiB;
- the Redis stream contains no source payload and retains no entry, delivery
  mapping, or pending consumer after settlement;
- a synthetic consumer crash leaves a real PEL entry and the independently
  running worker reclaims it without skipping or disconnecting;
- the worker creates one claim, one terminal result, one committed settlement,
  one `index.ingest.completed` replay event, and the exact current completion
  message;
- source receipts contain each image twice, total 124 MiB, 22 authenticated
  vision calls, at least one embedding call, and a model request over 32 MiB;
- replay and output records remain bounded, and public SSE returns bounded
  progress plus terminal replay rather than source/model bytes;
- restarting the worker after settlement produces no duplicate claim, source
  read, model call, result, settlement, or replay terminal;
- a second execution stopped before claim is durably cancelled, retired from
  Redis, and never reaches the data plane.

Provider and PgVector business parity is characterized independently in
`tests/parity/confluence_indexing`. This gate requires that same current
toolkit/model/PgVector behavior to finish successfully; it does not substitute a
mock SDK adapter.

## Dedicated environment prerequisites

Use a disposable or dedicated project. The test refuses to start while any
`index.ingest.v1` execution, stream entry, delivery mapping, or pending delivery
already exists.

Provision through the current application APIs/UI:

1. A Confluence credential whose base URL is
   `http://host.docker.internal:<fixture-port>`. Its token may be a non-secret
   fixture value, but it must pass the current schema.
2. A Confluence toolkit in the test project using that credential, a real
   project-specific PgVector configuration, and the fixture LLM/embedding
   models.
3. Runtime-interface/LiteLLM model routes that direct the selected vision and
   embedding models to the fixture server's OpenAI-compatible `/v1` endpoints.
   Keep current project and bearer headers enabled. Do not place credentials in
   the request file.
4. An active PAT for the browser-session actor. The worker redeems it only
   through the current workload-identity/runtime-context path.
5. The normal hybrid runtime services, TLS certificates, Redis ACLs, index
   route, external LiteLLM, and standalone `elitea-indexer-worker`.

The fixture port must be reachable from the worker as
`host.docker.internal:<fixture-port>`. The runner verifies this before stopping
the worker or admitting work.

Create a caller-safe request file:

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

Store the raw authenticated `Cookie` header value in an owner-only file
(`chmod 600`). Run from the repository root:

```bash
ELITEA_CENTRY_DIR=/absolute/path/to/centry \
ELITEA_AUTH_POV_RUNTIME_DIR=/absolute/private/path/auth-pov-runtime \
ELITEA_INDEX_TEST_COOKIE_FILE=/absolute/private/path/index-cookie \
ELITEA_INDEX_TEST_REQUEST_FILE=/absolute/path/index-5681-request.json \
ELITEA_INDEX_TEST_PROJECT_ID=1 \
ELITEA_INDEX_5681_FIXTURE_PORT=18681 \
services/elitea-main/tests/reliability/index_5681/run.sh
```

The wrapper, not a bare `go test`, is the acceptance entry point. It fails with
exit code 2 when a required environment value, command, file, file permission,
fixture port, Compose runtime, or running service is absent. Exit code 1 means
the provisioned gate ran and a contract failed; exit code 0 is the only pass.
The wrapper validates the fixture profile and unit tests, enables the opt-in Go
system test, and sets the maximum 15-minute budget. Neither fixture nor test logs
expose cookies, PATs, Redis passwords, protected bundle bytes, source images,
signed envelopes, or SSE data.

## Manual GitHub Actions contract

The checked-in workflow keeps ordinary pull requests deterministic: it verifies
the fixture, runner syntax, and compiled Go profile assertion without claiming a
cross-process pass. The real job runs only from `workflow_dispatch` on a
dedicated self-hosted runner carrying both labels `self-hosted` and `index-5681`.

Configure these repository or environment variables on that runner:

| Workflow variable | Runner value |
| --- | --- |
| `ELITEA_INDEX_5681_CENTRY_DIR` | Absolute Centry checkout containing the active Compose deployment |
| `ELITEA_INDEX_5681_RUNTIME_DIR` | Absolute private runtime-certificate directory |
| `ELITEA_INDEX_5681_COOKIE_FILE` | Absolute owner-only file containing the current raw Cookie header |
| `ELITEA_INDEX_5681_REQUEST_FILE` | Absolute non-secret request JSON prepared above |
| `ELITEA_INDEX_5681_PROJECT_ID` | Dedicated project ID owning the provisioned toolkit and models |
| `ELITEA_INDEX_5681_FIXTURE_PORT` | Free unprivileged host port reachable through `host.docker.internal` |
| `ELITEA_INDEX_5681_BASE_URL` | Optional HTTPS Elitea origin; defaults locally to `https://localhost:18443` |

Start the opt-in job without putting any credential content in workflow inputs:

```bash
gh workflow run index-5681-reliability.yml
```

The job summary distinguishes `prerequisite-failure` from `test-failure`.
Neither is reported as a pass. A successful summary is evidence only for the
specific provisioned revision and environment on which the real job ran.

## Evidence classification and residuals

This is a state-changing system/end-to-end reliability test against already
running production-composition processes. The synthetic crashed Redis consumer
is the only transport test double; the recovering worker is the real standalone
Python process. Confluence and LiteLLM are deterministic network fixtures, while
PostgreSQL, Redis Streams, mTLS control/content/output, RBAC, tenant routing,
worker workload identity, SDK, PgVector, and SSE are real.

It is not a soak, multi-worker load, certificate-rotation, external-Confluence,
or external-model-provider test. Those remain separate release gates. The
fixture server is test-only and introduces no production endpoint, feature
flag, dependency, or alternate business implementation.
