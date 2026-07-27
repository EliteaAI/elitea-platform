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
| Model, vector-store, embedding and dimension compatibility comes from the persisted toolkit configuration, while the generic test API separately accepts LLM model/configuration. | `base_indexer_toolkit.py:1007-1055`; `client.py:1312-1446` | `IndexSearchInputBindingV1` binds toolkit, tool, LLM and MCP entries by immutable digest. It does not invent an independent dimension field. | Source parity only |

## Authorization and tenancy boundary

`AuthorizedScope` requires tenant, resource-project, projection-project, and
principal identities before a request can be constructed. Those values must be
returned by the existing current-RBAC resolver after checking the actual
toolkit/test permission; they are not fields in an HTTP request or worker
command. The command carries only content entry IDs. This package deliberately
does not claim RBAC parity until a mounted admission path uses the current
permission resolver and has service-backed tests for allow, deny, cross-project
and role-change cases.

## Verification evidence

| Check | Boundary actually exercised |
| --- | --- |
| `go test ./internal/application/indexsearch` | Go unit: identity/input binding, operation allowlist, no control-plane content leak, exact immutable model/configuration bindings. |
| `go test ./tests/contract` | Go protobuf contract: decodes the deterministic command bytes created by the checked Python binding. |
| `pytest tests/unit/test_index_search.py` | Python unit: three operation branches, error/no-result pass-through, no SDK call for another operation, current invocation copy boundary, result artifact binding. |
| `pytest tests/integration/test_index_search_protocol_contract.py` | Python-to-Go wire fixture producer; this is language binding interoperability, not a deployed worker integration. |

## Explicit remaining work before mounting

1. Bind the current RBAC permission and project/tenant resolver to an
   admission transaction; test each current platform role and a cross-project
   denial against real PostgreSQL.
2. Build the immutable input bundle and artifact writer, including a bounded,
   current-compatible safe projection of successful, no-result, SDK-error and
   MCP-authorization responses.
3. Add the command/result to `WorkerCommandV1`/output framing, implement
   claim/settlement, cancellation and durable replay, and register it only
   after those pieces are complete.
4. Port current NodeEvent/Socket.IO response projection or intentionally map it
   through the agreed SSE path with browser parity tests.
5. Run cross-process PostgreSQL, Redis, TLS/gRPC and browser tests, then load
   and reliability tests. None are claimed by this source-only slice.
