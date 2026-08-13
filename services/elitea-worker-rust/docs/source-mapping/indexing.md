# Indexing source mapping

Indexing follows the agent runtime and configuration/toolset foundations. The
authoritative capability inventory remains the workspace
`ELITEA_INDEXING_CAPABILITY_PARITY_MATRIX.md`; this tracked ledger binds that
behavior to eventual Rust ownership without claiming implementation.

## Worker and protocol mapping

| Python source path and symbol | Observable behavior | Rust target | Proving tests | Status / deviation |
| --- | --- | --- | --- | --- |
| `libs/proto/elitea/runtime/v1/indexing.proto` | Language-neutral index command/input/result contract | `src/protocol/mod.rs`, `src/indexing/protocol.rs` | Cross-language canonical binary fixtures | Planned |
| Platform Python worker `handlers/indexing.py::IndexIngestDeliveryProcessor` and progress callback | Claim-bound SDK execution and bounded `NodeEventV1` progress | `src/indexing/delivery.rs`, `src/compat/node_events.rs` | Delivery, progress ordering, terminal/error and cancellation component tests | Planned |
| Platform Python worker `protocol/indexing.py` | Strict typed request/result validation | `src/indexing/protocol.rs` | Canonical/noncanonical, bound and limit tests | Planned |
| Centry `indexer_worker/methods/indexer_index.py` and related registrations | Manual/scheduled index dispatch and SDK invocation | `src/indexing/ingest.rs` | Manual/scheduled differential and real-service tests | Planned |
| Centry indexing callbacks and event helpers | Thinking/progress/error/terminal payloads | `src/indexing/events.rs`, `src/compat/node_events.rs` | Ordered current UI/event corpus | Planned |
| SDK index configuration/type registry | Source types, schemas and required settings | `src/indexing/sources/registry.rs` | Generated source manifest and schema differentials | Planned |
| SDK loader/parser/splitter implementations | Source-specific discovery, fetch, normalize, parse and chunk | `src/indexing/sources/<family>/` | Source fixtures, property tests and bounded live tests | Planned or externalized per family |
| SDK embedding/vectorstore path | Embedding batches, PGVector write/search and index identity | `src/indexing/embedding.rs`, `src/indexing/vectorstore.rs` or provider boundary | Real PostgreSQL/PGVector tests at bounded concurrency | Planned; lifecycle pressure must be validated |
| Centry schedule, stop, cleanup and notification behavior | Schedule/manual distinctions, cancellation, cleanup and capability-owned notification effects | `src/indexing/lifecycle.rs` plus Main contracts | Restart, stop, ACK-loss, cleanup and notification E2E tests | Planned; notification recipient/metadata remain Main-owned |

## Shared toolkit indexing overlay

The SDK exposes the same six index tools through 17 toolkit families:

`index_data`, `list_indexes`, `search_index`, `stepback_search_index`,
`stepback_summary_index`, and `remove_index`.

| Python source | Families | Rust target | Status / deviation |
| --- | --- | --- | --- |
| SDK `tools/base_indexer_toolkit.py::BaseIndexerToolkit` | Common six-tool schema and dispatch | `src/indexing/toolset_overlay.rs` | Planned after core indexing contract |
| SDK `tools/code_indexer_toolkit.py::CodeIndexerToolkit` | GitHub, GitLab, Bitbucket, ADO Repos | `src/indexing/sources/code_host/` plus per-family adapters | Planned |
| SDK `tools/non_code_indexer_toolkit.py::NonCodeIndexerToolkit` | ADO plans/boards/wiki, Jira, Confluence, Figma, qTest, SharePoint, TestRail, Xray, Zephyr Enterprise/Essential/Scale | `src/indexing/sources/<family>/` | Planned |
| SDK `tools/elitea_base.py::BaseVectorStoreToolApiWrapper` and `tools/vector_adapters/VectorStoreAdapter.py` | Vectorstore/project/collection identity and operations | `src/indexing/vectorstore.rs` | Planned; use explicit typed ownership rather than mutable wrapper settings |
| SDK `tools/index_params.py` | Input schema and search/index parameters | `src/indexing/types.rs` | Planned; property/differential validation |

Indexing functions are not counted as completed when their surrounding toolkit
family is ported. They become available only when the shared indexing overlay,
source adapter, durable lifecycle, vectorstore ownership, and failure/recovery
tests all pass.

## Required gates

- Generate the complete current source-family manifest before implementation
  completeness claims.
- Keep source retrieval/parsing behavior compatible, while externalizing a
  family when a dedicated provider service is a safer ownership boundary.
- Bound source concurrency, document counts, bytes, parser recursion,
  embedding batches, provider calls and database connections.
- Treat at-least-once delivery, cancellation, stale claims, restart, lost ACK,
  partial progress and cleanup as first-class system tests.
- Test mixed predict/index concurrency at representative limits while observing
  worker queues, PgBouncer and PostgreSQL recovery; an engine cache is not a
  concurrency limit.
- Keep ordinary search as toolkit functionality. Do not invent a separate
  `index.search.v1` subsystem.
- Keep notification creation capability-owned; the worker cannot select
  arbitrary recipients or notification metadata.
