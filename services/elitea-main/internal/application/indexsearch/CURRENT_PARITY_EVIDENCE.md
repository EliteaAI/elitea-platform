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
| The SDK constructs `OpenAIEmbeddings` from the selected embedding-model name and Main LLM endpoint/PAT/project; the vector-store toolkit passes that embedding object into the saved vector-store settings. | `elitea_sdk/runtime/clients/client.py:371-384`; `elitea_sdk/runtime/tools/vectorstore_base.py:157-158` | Index admission records a distinct immutable embedding binding; search/list/stepback must consume that recorded generation binding. | Source parity only |
| Current saved `embedding_model` data has `name` plus an `ai_credentials` configuration reference. Configurations projects the group as `{project_id}_{name}` and records `centry_configuration_uuid`; provider comes from the credential-type mapper. | `elitea_sdk/configurations/embedding.py`; `runtime_interface_litellm/.../configuration_transformations.py`; Go parity mapper `internal/infra/litellm/mapper.go` | The binding records model name, resolved group, configuration project/UUID/digest and provider. It contains no secret, endpoint, header or deployment ID. | Source parity only |
| Neither the current Configurations shape nor the SDK call supplies an authoritative semantic model version or embedding dimension. LiteLLM `model_info.id` identifies a deployment, not a model version. | Same sources above; current tenant-table row inspection performed 2026-07-27 | Version/dimension remain absent unless a future authoritative runtime field explicitly supplies them. They are never inferred from a model name. | Proven absence; fail closed |

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

## Immutable embedding-generation binding

`CurrentEmbeddingBindingResolver` reproduces only the managed part of the
current resolution order: exact project configuration first, then an exact
shared public-project configuration. It rejects the current raw external-name
LiteLLM fallback because that fallback has no Configurations-owned immutable
identity to bind. Adding such an authority is separate work; silently treating
a mutable raw name as immutable would make an index unreproducible.

The saved Configurations adapter performs a tenant-routed, exact
`type='embedding_model'`, `section='embedding'`, `status_ok=true`,
`data.name=model` query with a two-row ambiguity sentinel. It reads the stored
reference form only and never expands `ai_credentials`. The LiteLLM adapter
allowlists only group, provider and `centry_configuration_uuid`; arbitrary
`litellm_params`, credentials, endpoints and `model_info.id` do not enter the
binding.

Admission canonicalizes the non-secret binding into an existing immutable
input-bundle entry with semantic role `index.embedding_binding`. The same
transaction already persists input bundle, generation, execution job and
outbox. Redis and worker protobufs carry only entry ID/version/digest. No
embedding registry, schema column or migration was introduced.

Production index admission now composes `CurrentEmbeddingBindingResolver` from
the existing tenant-routed Configurations repository and the existing
authenticated LiteLLM administration client. The UI's common omitted
`embedding_model` shape and the explicit empty shape both consult the current
Configurations embedding catalog: an authoritative default is frozen into the
toolkit snapshot and bound; no name is invented when the catalog has no
default. An explicit model is never replaced. Admission fails closed with a
safe typed HTTP response when a required binding is unavailable, malformed, or
ambiguous.

The Python worker accepts the optional `index.embedding_binding` entry only
when the signed command's entry ID, immutable version, and SHA-256 digest match
the claim manifest. It then validates the non-secret binding against the
already-frozen toolkit snapshot and copies the exact `resolved_model_group`
into a claim-scoped client context. The SDK adapter changes only the
invocation-local deep copy of `settings.embedding_model`; the
`EliteAClient.test_toolkit_tool` method and keyword shape remain unchanged.
The worker never re-queries Configurations or LiteLLM and echoes the exact
binding reference in its terminal result. Redis still contains only the
reference and digest.

Pre-binding rows without the entry remain valid only when their frozen toolkit
snapshot does not declare an embedding model. A row that declares an embedding
model but lacks or mismatches the binding fails with a safe typed worker error.
Historical search/list/stepback validation returns
typed `LEGACY_EMBEDDING_BINDING_MISSING`; it must not re-resolve today's
mutable default. Other typed failures cover stale generation, scope, model,
configuration and explicit-dimension mismatches.

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
| `go test ./internal/application/indexsearch` | Go unit: identity/input binding, operation allowlist, no control-plane content leak, exact immutable model/configuration bindings. |
| `go test ./internal/application/indexing ./internal/infra/db/repos ./internal/infra/litellm ./internal/transport/redisdispatch` | Go unit: project/public model resolution, canonical non-secret digest, ambiguity/fail-closed cases, atomic bundle-entry reference, bounded Redis reference contract, tenant-routed Configurations query, and allowlisted LiteLLM projection. |
| `go test -race ./internal/infra/db/repos -run TestCurrentEmbeddingBindingResolvesFromTenantPostgresAndLiteLLM` with `ELITEA_TEST_DATABASE_URL` | Real PostgreSQL project-to-shared-public tenant routing, private-public rejection, and fake authenticated LiteLLM group/model endpoints; proves the composed binding without inferring version or dimension. |
| `go test -race ./internal/application/indexing ./internal/api/v2/indexing ./internal/runtimecomposition` | Race-enabled admission/default/composition and safe HTTP error behavior. |
| `go test ./internal/api/v2/indexsearch` | Go HTTP component: exact current path/permission/event, trusted-auth and dynamic project-RBAC-before-body ordering, opaque async/await response envelopes, timeout cancellation intent, and unsupported-operation rejection. |
| `go test ./tests/contract` | Go protobuf contract: decodes the deterministic command bytes created by the checked Python binding. |
| `pytest tests/unit/test_index_search.py` | Python unit: three operation branches, error/no-result pass-through, no SDK call for another operation, current invocation copy boundary, result artifact binding. |
| `pytest tests/unit/test_indexing.py tests/integration/test_index_ingest_delivery.py` | Python worker: optional and required binding validation, exact manifest reference/digest, exact resolved model group at the unchanged SDK call, terminal echo, pre-binding/mismatch rejection, and absence of binding content from Redis. |
| `pytest tests/integration/test_index_search_protocol_contract.py` | Python-to-Go wire fixture producer; this is language binding interoperability, not a deployed worker integration. |

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
7. Run cross-process PostgreSQL, Redis, TLS/gRPC and browser tests, then load
   and reliability tests. None are claimed by this source-only slice.
8. Run the mounted flow against the production-equivalent LiteLLM deployment
   and UI before release; this source repository test slice does not claim a
   browser/deployment checkpoint.
