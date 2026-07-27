# Current index-search parity evidence

## Scope and decision

This is a source-only, unmounted contract slice for these exact current SDK
tools: `search_index`, `stepback_search_index`, and `list_indexes`. It does
not replace the SDK vector-store algorithm, the current Pylon event wrapper,
or any UI route.

The strict design decision is that Main may authorize, persist immutable input
references, dispatch, and project a stored result, but it must not interpret a
search filter, select an embedding dimension, construct a vector query,
rerank, apply full-text/extended search, filter output fields, or rewrite a
no-result/error branch. The admitted SDK does that work exactly once.

## Source evidence matrix

| Current behavior | Evidence | This slice | Status |
| --- | --- | --- | --- |
| `list_indexes` delegates to vector-store collection listing. | `elitea-sdk/elitea_sdk/tools/base_indexer_toolkit.py:964-966` | Typed `LIST_INDEXES` operation; SDK delegate. | Source parity only |
| `search_index` checks a named index, adds collection/meta-document filtering, delegates vector/full-text/reranking/extended search, applies output-field projection, then returns either a list or its exact string branch. | `base_indexer_toolkit.py:980-1061`, `1063-1139` | Raw tool parameters are immutable opaque input content; no Go/Python reimplementation. | Source parity only |
| `stepback_search_index` uses the stepback LLM path and has a different `Found N...`/`No documents...` string result contract. | `base_indexer_toolkit.py:1141-1164`; `runtime/tools/vectorstore_base.py:618-646` | Distinct `STEPBACK_SEARCH_INDEX` operation and opaque response artifact. | Source parity only |
| Pydantic schema accepts filter, cutoff, top-N, full-text, extended search, legacy/advanced reranking; only `search_index` declares output fields; defaults and limits are SDK-owned. | `tools/index_params.py:28-130` | No duplicate validation beyond object/identity safety; exact SDK validation remains authoritative. | Source parity only |
| Vector algorithm implements extended chunk retrieval, full-text score merge, reranking, cutoff, ordering and output formatting. | `runtime/tools/vectorstore_base.py:370-617` | Explicitly excluded from Main and the new worker kernel. | Preserved in SDK |
| Current worker runs a generic `EliteAClient.test_toolkit_tool`, forwards current `runtime_config`, deep-copies persisted toolkit/tool/LLM inputs, and derives UI event/full-message output around the SDK response. | `centry/pylon_indexer/plugins/indexer_worker/methods/indexer_test_toolkit.py:408-707`; `elitea_sdk/runtime/clients/client.py:1312-1515` | `EliteaSdkIndexSearchAdapter` mirrors the one SDK invocation/copy boundary; handler intentionally leaves exceptions to a later current-event parity wrapper. | Source parity only |
| The SDK constructs `OpenAIEmbeddings` from the configured raw embedding-model name and Main LLM endpoint/PAT/project; the vector-store toolkit passes that object into the saved vector-store settings. | `elitea_sdk/runtime/clients/client.py:371-384`; `elitea_sdk/runtime/tools/vectorstore_base.py:157-158` | The worker preserves the model name and the exact SDK invocation. It does not rewrite the model to a LiteLLM group. | Implemented and unit/integration tested |
| The current LiteLLM facade checks `{project_id}_{model}`, then `{public_project_id}_{model}`, then forwards the raw name for an externally managed model. It always authenticates with the caller project's key. | `runtime_interface_litellm/methods/proxy.py:145-180` | Admission performs the same bounded group-existence checks and records the observed `project`, `public`, or `raw` route. Execution deliberately re-resolves through the same facade. | Implemented and unit/integration tested |
| The current Configurations model catalog returns an authoritative default tuple of `default_model_name` and `default_model_project_id`; a duplicate name may exist in both the caller and public project. | `configurations/utils_models.py:109-280`; Go parity implementation `internal/application/configurations/current_models.go` | Omitted/empty UI input retains the exact name/project tuple. The tuple's configuration identity is independent of the project-first proxy route, so duplicate names are not silently rebound. | Implemented and unit tested |
| Current saved embedding configurations contain `data.name` and an `ai_credentials` reference. Neither this shape nor the SDK call provides an authoritative deployment, endpoint, provider version, semantic model version, or embedding dimension. | `elitea_sdk/configurations/embedding.py`; `configurations/models/pd/llm_model.py`; `elitea_sdk/runtime/clients/client.py:371-384` | The binding records only model name, optional model-project tuple, observed route, and optional non-secret configuration project/UUID/digest. It contains no expanded credential, endpoint, deployment, provider, version, or dimension claim. | Implemented and validation-tested |

## Current HTTP/RBAC boundary

The exact current API route is `POST
/api/v2/elitea_core/test_toolkit_tool/prompt_lib/{projectID}`. The current
decorator requires `models.applications.tool.patch` in default mode. Its
`admin`/`editor`/`viewer` list is a recommendation/seed, not the runtime
authorization algorithm: the current permission resolver decides from the
project's effective grants, including project-specific overrides. A port must
therefore check the permission through the current resolver, scoped to the URL
project, and must not replace it with a Go list of role names.

`api/v2/indexsearch.CurrentIndexSearchRoute` is an **unmounted** component
contract that proves that order: trusted authentication, dynamic project RBAC,
then body parsing and admission. It preserves the current request defaults,
the forced URL project identity, `await_response`/`timeout` choice, optional
correlations and the opaque complete response envelope. It accepts only the
three index read operations so that it cannot accidentally take over indexing
or other generic toolkit tools at the shared current path.

Sources: `elitea_core/api/v2/test_toolkit_tool.py:28-85`,
`elitea_core/models/pd/test_toolkit_tool.py`, and
`elitea_core/rpc/application.py:1142-1391`.

## Authorization and tenancy boundary

`AuthorizedScope` requires tenant, resource-project, projection-project, and
principal identities before a worker command can be constructed. Those values
must be returned by the existing current-RBAC resolver after checking the actual
toolkit/test permission; they are not fields in an HTTP request or worker
command. The command carries only content entry IDs. The route component locks
the current permission/project boundary in unit tests, but it does not yet make
the required admission transaction or claim production RBAC parity.

## Embedding admission record and current-route parity

`CurrentEmbeddingBindingResolver` reproduces the current LiteLLM facade's
project-to-public-to-raw route. It performs exact, bounded model-group lookups
for the caller and public project. If neither managed group exists, it records
the raw route without attempting to prove that an externally managed model
exists; this is the current proxy behavior.

The record does **not** pin execution to the route observed at admission.
The worker passes the original model name to the admitted SDK unchanged, and
the SDK calls Main's authenticated LiteLLM facade with the execution actor's
PAT and project. LiteLLM therefore selects the current deployment, endpoint,
credentials, and provider at execution exactly as it does today. The recorded
route is immutable evidence for generation compatibility and diagnostics, not
a second routing authority.

When the current catalog supplies a default, admission preserves the complete
`(model_name, model_project_id)` tuple. The model project must be either the
authorized caller project or the configured public project. Its exact saved
configuration is loaded from that tenant schema; public-project lookup also
requires `shared=true`. This prevents a duplicate name in another project from
silently replacing the catalog-selected default even though the runtime proxy
continues to check the caller's model group first.

For an explicit saved model without a catalog-selected tuple, the
Configurations adapter checks the authorized caller project first and then an
exact shared public row. A model may legitimately have no Configurations row
when it uses the current raw external-name fallback. The adapter performs a
tenant-routed exact `type='embedding_model'`, `section='embedding'`,
`status_ok=true`, `data.name=model` query with a two-row ambiguity sentinel. It
reads only the saved `name` and `ai_credentials` reference; it never expands a
credential.

Admission canonicalizes the non-secret binding into an existing immutable
input-bundle entry with semantic role `index.embedding_binding`. The same
transaction already persists input bundle, generation, execution job and
outbox. Redis and worker protobufs carry only entry ID/version/digest. No
embedding registry, schema column or migration was introduced.

Production index admission composes `CurrentEmbeddingBindingResolver` from the
existing tenant-routed Configurations repository and authenticated LiteLLM
administration client. The UI's common omitted `embedding_model` shape and the
explicit empty shape both consult the current Configurations embedding
catalog: an authoritative name/project tuple is frozen into the toolkit
snapshot and binding; no name is invented when the catalog has no default. An
explicit non-empty model is never replaced. Admission fails closed with a safe
typed HTTP response when a required catalog/configuration binding is
unavailable, malformed, or ambiguous.

The Python worker accepts the optional `index.embedding_binding` entry only
when the signed command's entry ID, immutable version, and SHA-256 digest match
the claim manifest. It validates the non-secret record against the
already-frozen toolkit snapshot but does not use `resolved_model_group` to
route the SDK. The `EliteAClient.test_toolkit_tool` method, model name, and
keyword shape remain unchanged. The worker never re-queries Configurations or
LiteLLM and echoes the exact binding reference in its terminal result. Redis
still contains only the reference and digest.

The binding schema change is carried by `index.ingest.v1` capability version
`2`. Production Main emits and verifies index commands at version `2` while
configuration validation remains version `1`. The new worker advertises index
version `2` and rejects an index version `1` envelope during command
verification, before claim or input fetch. Deployment must therefore drain or
terminally reconcile version `1` index work before enabling Main version `2`;
the source stream is not a mixed-version routing mechanism. Version `2` uses a
new versioned stream and consumer group after the version-`1` route is proven
empty.

Pre-binding rows without the entry remain valid only when their frozen toolkit
snapshot does not declare an embedding model. A row that declares an embedding
model but lacks or mismatches the binding fails with a safe typed worker error.
Historical search/list/stepback validation returns
typed `LEGACY_EMBEDDING_BINDING_MISSING`; it must not re-resolve today's
mutable default. Other typed failures cover stale generation, scope, model,
model-project and configuration mismatches.

`BuildHistoricalEmbeddingInventory` is the source-only mount preflight for
those operations. Coverage means enumerating every distinct non-empty
`cmetadata.collection` from vector rows, not merely rows whose type is
`index_meta`; this preserves current `list_indexes` and empty-`index_name`
search/stepback behavior. A generation is exact only when its external
metadata identity matches exactly one durable Main execution/index job and
exactly one immutable input-bundle entry with semantic role
`index.embedding_binding`, with valid content digest and binding schema.
`ExactHistoricalEmbeddingBackfill` can copy only that already-persisted
reference and non-secret record into a future association. It never resolves
the current model catalog, LiteLLM route, toolkit setting, vector dimension,
or configuration as a substitute.

Missing or duplicate metadata, incomplete execution linkage, absent or
ambiguous binding entries, malformed content, and every current-baseline
generation without exact evidence are `REINDEX_REQUIRED`. An operator
approval is bound to the exact project/toolkit/index/generation and source
metadata digest, so a changed inventory invalidates the approval. Approval
records operator intent only: it never makes old vector data searchable.
Search, list, and stepback mounting remains blocked when collection coverage is
incomplete, any item is unresolved, or any item remains
`REINDEX_REQUIRED`. After reindexing, a fresh complete inventory must prove the
replacement generation's exact immutable evidence. The inventory contract is implemented and unit tested, but its
external PgVector collection enumerator and central evidence repository are
not yet composed; therefore this document does not claim those routes are
mountable.

## Index admission authorization evidence

The production route remains the exact current
`POST /api/v2/elitea_core/test_toolkit_tool/prompt_lib/{projectID}` boundary
and checks `models.applications.tool.patch` through the existing dynamic
PostgreSQL permission resolver before body parsing. The authenticated URL
project becomes the resource and projection scope used by admission; neither
the request body nor the worker may select another tenant/project. Embedding
configuration selection uses that same authorized project first and only then
the configured public project with `shared=true`. The binding stores project
and configuration identity, but never grants access and never carries
credentials.

## Verification evidence

| Check | Boundary actually exercised |
| --- | --- |
| `go test ./internal/application/indexsearch` | Go unit: identity/input binding, operation allowlist, no control-plane content leak, exact model-project/configuration compatibility. |
| `go test ./internal/application/indexing ./internal/infra/db/repos ./internal/infra/litellm ./internal/transport/redisdispatch ./internal/transport/runtimegrpc/control` | Go unit: exact project/public/raw route, default tuple retention, canonical non-secret digest, shared Go/Python validation fixture, ambiguity/fail-closed cases, bounded catalog and Redis reference contracts, and capability-specific version verification. |
| `go test -race ./internal/infra/db/repos -run TestCurrentEmbeddingBindingResolvesFromTenantPostgresAndLiteLLM` with `ELITEA_TEST_DATABASE_URL` | Real PostgreSQL tenant schemas plus fake authenticated LiteLLM: caller miss, public hit, exact saved public configuration, and private-public denial. No deployment/provider/version/dimension claim is made. |
| `go test -race ./internal/infra/db/repos -run TestPostgresServiceBackedCurrentModelCatalogBoundsBeforeJSONProjection` with `ELITEA_TEST_DATABASE_URL` | Real PostgreSQL rejects a projected catalog above 8 MiB and the 10,001st row before sqlc materializes JSONB, while retaining the current-valid 300 KiB single-row case. The bounds/list pair uses one read-only REPEATABLE READ snapshot. |
| `go test ./internal/application/indexsearch -run TestHistoricalEmbeddingInventory` | Source-only historical collection gate: complete coverage, exact immutable evidence, digest-bound reindex intent, no synthesis from current state, and list/global-search/stepback blocking until a fresh inventory proves the replacement generation. It does not claim the external inventory is composed. |
| `go test -race ./internal/application/indexing ./internal/api/v2/indexing ./internal/runtimecomposition` | Race-enabled admission/default/composition, production index capability version `2`, and safe HTTP error behavior. |
| `go test ./internal/api/v2/indexsearch` | Go HTTP component: exact current path/permission/event, trusted-auth and dynamic project-RBAC-before-body ordering, opaque async/await response envelopes, timeout cancellation intent, and unsupported-operation rejection. |
| `go test ./tests/contract` | Go protobuf contract: decodes the deterministic command bytes created by the checked Python binding. |
| `pytest tests/unit/test_index_search.py` | Python unit: three operation branches, error/no-result pass-through, no SDK call for another operation, current invocation copy boundary, result artifact binding. |
| `pytest tests/unit/test_indexing.py tests/integration/test_index_ingest_delivery.py` | Python worker: shared binding validation, exact manifest reference/digest, unchanged raw SDK model name, terminal echo, version-`1` pre-claim rejection, pre-binding/mismatch rejection, and absence of binding content from Redis. |
| `pytest tests/parity/test_sdk_lock.py tests/parity/test_index_ingest_current_parity.py` | Exact current SDK baseline: distribution `0.8.30`, source revision `48c51a16634a9924f6c5d5313c3bacedb0b5b56b`, admitted dependency surface, and the single current indexing call boundary. |
| `pytest tests/integration/test_index_search_protocol_contract.py` | Python-to-Go wire fixture producer; this is language binding interoperability, not a deployed worker integration. |
| `ELITEA_INDEX_BINDING_CROSS_PROCESS_TEST=1 go test ./services/elitea-main/tests/system -run TestIndexEmbeddingBindingMainWorkerCrossProcess` | Real Go-to-Python process boundary: Main default owner tuple and project/public/raw observation, production Ed25519 signing/authentication, stale index version `1` rejection before claim, version `2` reaching claim, exact binding-reference digest, and no model/credential/deployment content in the control envelope. CI installs the exact worker-locked SDK source before running it. It does not contact Redis, PostgreSQL, LiteLLM, PgVector or a provider. |
| `index-v2-preflight --spool-root ...` | Operator gate against the stopped version-1 release configuration: zero live v1 jobs, unretired outbox rows, unreleased claims, source stream entries, PEL entries, delivery mappings, and files in every old worker replica's private durable spool root. Any missing reader/group/root or dependency failure blocks. |

## Explicit remaining work before mounting

1. Bind the route's current-RBAC identity and project scope to an admission
   transaction, then test effective project grants, cross-project denial and
   role/grant changes against real PostgreSQL. Do not hard-code the four role
   names: the current resolver is authoritative.
2. Replace the route's caller-supplied transient toolkit payload with the
   current server-side configuration expansion/unsecreting authority. The
   source-only component carries opaque fields solely to map the current
   boundary; it is not safe to mount until that replacement exists.
3. Build the immutable input bundle and artifact writer, including a bounded,
   current-compatible safe projection of successful, no-result, SDK-error and
   MCP-authorization responses.
4. Add the command/result to `WorkerCommandV1`/output framing, implement
   claim/settlement, cancellation and durable replay, and register it only
   after those pieces are complete.
5. Port current NodeEvent/Socket.IO response projection or intentionally map it
   through the agreed SSE path with browser parity tests.
6. Resolve the documented HTTP differences before mounting: the source-only
   route bounds body size and returns reviewed typed errors, while the current
   Flask endpoint has Pydantic coercion/raw validation and lets an invalid
   timeout conversion escape its generic exception branch.
7. Treat capability `1` to `2` as a coordinated cutover, never a mixed rolling
   deployment:

   1. Close indexing admission at ingress and scale every version-`1` Main
      producer to zero. Keep version-`1` workers running while already-admitted
      work drains.
   2. Recover or terminally reconcile every version-`1` job through the normal
      durable state machine. Do not delete job, outbox, claim, stream, delivery
      mapping, or spool rows/files by hand.
   3. After database and source Redis work are empty, stop all version-`1`
      workers. Mount every stopped replica's durable spool root read-only into
      the preflight job.
   4. Run the command below with `DATABASE_URL` and the old version-`1`
      release's authenticated Redis/TLS configuration. It must exit zero and
      report only zero counts. Re-run it after any reconciliation:

      ```bash
      index-v2-preflight \
        --spool-root /mnt/worker-0/output-spool \
        --spool-root /mnt/worker-1/output-spool
      ```

   5. Deploy every version-`2` worker against a new versioned stream and
      consumer group while admission remains closed. Verify worker health and
      capability `2`.
   6. Deploy version-`2` Main against that same new route, verify health, then
      and only then reopen indexing admission.

   Before step 6 admits any version-`2` command, rollback is: stop version-`2`
   Main/workers, restore the version-`1` workers and Main with their old route,
   verify health, then reopen admission. After any version-`2` command is
   admitted, binary rollback to version `1` is prohibited: freeze admission,
   drain or terminally reconcile version `2`, and roll forward or execute a
   separately reviewed symmetric cutover. Never attach a version-`1` worker to
   a version-`2` stream or vice versa.
8. Run cross-process PostgreSQL, Redis, TLS/gRPC and browser tests, then load
   and reliability tests. None are claimed by this source-only slice.
9. Compose the historical collection enumerator and immutable central evidence
   loader, produce a complete inventory, and reindex every
   `REINDEX_REQUIRED` collection before mounting search/list/stepback. Current
   Configurations or LiteLLM state is never acceptable backfill evidence.
10. Run the mounted flow against the production-equivalent LiteLLM deployment
   and UI before release; this source repository test slice does not claim a
   browser/deployment checkpoint.
