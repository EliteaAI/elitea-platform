# Rust worker source parity

- Status: reconstruction foundation plus agent protocol and ordered output-session slices
- Last verified: 2026-08-13
- Production capability registration: disabled

The previous Rust worker implementation was never committed and no recoverable
Rust source exists in this repository's refs or Git objects. This directory is
the first durable reconstruction checkpoint. Historical reports of ADK-backed
execution, configuration or toolkit implementations, PostgreSQL checkpoints,
and their test counts are not implementation evidence.

The external contract remains the language-neutral protocol under
`libs/proto/elitea/runtime/v1`. ADK-Rust is an internal agent-runtime substrate;
its types must not replace the Elitea command, input, output, settlement, or
browser-event contracts.

## Reconstruction order

1. Establish the tracked Rust shell, strict protocol parsing, and conformance
   fixtures for both `agent.execute.adhoc.v1` and
   `agent.execute.application.v1`.
2. Establish the shared configuration/toolset kernel and source-derived family
   inventory required by agent execution.
3. Implement new-lineage agent execution using reviewed ADK-Rust 2.0 primitives,
   including sessions, PostgreSQL checkpointing, progressive skills, MCP,
   HITL/continuation, graph parallel nodes, and bounded parallel subagents.
4. Migrate indexing capabilities after the agent track using the indexing
   capability parity matrix.

## Current source-to-Rust mapping

Detailed ledgers:

- [`docs/source-mapping/agent-runtime.md`](docs/source-mapping/agent-runtime.md)
- [`docs/source-mapping/configuration-toolsets.md`](docs/source-mapping/configuration-toolsets.md)
- [`docs/source-mapping/indexing.md`](docs/source-mapping/indexing.md)
- [`docs/adk-rust-2.0.0-audit.md`](docs/adk-rust-2.0.0-audit.md)

| Source evidence | Observable responsibility | Rust target | Proof | Status |
| --- | --- | --- | --- | --- |
| `libs/proto/elitea/runtime/v1/*.proto` | Language-neutral worker command, input, output, control, and settlement contracts | `build.rs`, `src/protocol/`, `src/transport/` | Generated client compile plus Python-produced command, input, NodeEvent and output-frame binary fixtures; ACK/replay state corpus | Partial: strict agent protocol and one ordered output-session attempt are implemented; control transport, reconnect ownership and settlement are not |
| `services/elitea-worker-python/src/elitea_worker/protocol/codec.py` | Verify exact signed bytes before closed-wire command decode and validate the selected capability | `src/protocol/{command,wire}.rs` | `tests/agent_command_contract.rs` HMAC/Ed25519 vectors and authenticated mutation corpus | Partial: application/ad-hoc command admission is implemented; other capabilities and offline execution envelope are not |
| `services/elitea-worker-python/src/elitea_worker/protocol/agent.py` | Strict `AgentExecutionInputV1` parsing and result binding | `src/agents/protocol.rs`, `src/agents/result.rs` | `tests/agent_input_contract.rs` application/ad-hoc, limits, mutation and terminal corpus | Partial: input construction and three admitted result states pass; delivery is not implemented |
| `services/elitea-worker-python/src/elitea_worker/handlers/agent.py` | Select application versus ad-hoc semantic entry point | `src/agents/request.rs` | Typed semantic fixture tests for both entry points | Foundation: immutable split exists; executor delegation is not implemented |
| Python worker `protocol/node_event.py` and Main `runtimegrpc/nodeevent/codec.go` | Bounded 13-field current JSON/`NodeEventV1` codec, arbitrary JSON fragments and Go-compatible escaping | `src/protocol/node_event.rs` | `tests/node_event_contract.rs`: existing 36-type corpus, Python wire/browser/drift vectors, limits and wire mutations | Intentional deviation: lossless compact fragment spellings and typed resource-limit failures follow the Go durable boundary; SDK/ADK event bridge is separate |
| Python worker `protocol/codec.py::{build_node_event_output_frame,build_output_frame,_runtime_error_message}` | Claim-fence-bound deterministic progress and terminal frames, safe errors, payload digests and settlement proposal | `src/protocol/output.rs` | Python-produced complete progress/success/cancellation `ExecutionOutputFrameV1` goldens plus identity/digest/fence/limit mutations | Implemented frame construction; PrepareSettlement execution is not |
| Python worker `transport/output_spool.py::EncryptedOutputSpool` and `serve.py::{_execution_spool_binding,_prepare_execution_spool}` | Execution-bound HKDF/AES-256-GCM disk format, immutable sequence publication, replay, exact replacement and ACK cleanup | `src/spool.rs` | Python-generated binding/directory/fixed-nonce golden plus `tests/output_spool_contract.rs` filesystem, capacity, corruption, ownership and cleanup corpus | Implemented synchronous primitive for macOS/Linux; Rust adds directory-relative operations and an advisory exclusive owner lock. The ordered output session now consumes this primitive |
| Python worker `transport/output_grpc.py::OutputGrpcSession` and Main `runtimegrpc/output/server.go::Server.Publish` | Pre-network recovery decision, one bootstrap grant, absolute credit, spool-before-send, exact bound ACK, ACK-before-delete, ordered replay, recovery CAS and typed winner/retry rejection | `src/transport/{output_session,output_grpc}.rs` | Pure ACK/credit/fence/sequence mutations plus component tests with the real encrypted spool, ACK loss, reopen, recovery replacement, reconciliation and exact replay | Implemented for one caller-verified tonic channel/session attempt. Bounded reconnect, TLS construction, control settlement and delivery coordination remain separate slices |
| Python worker `transport/control_grpc.py::ExecutionControlClient` and generated `RuntimeControlService` | One deadline-bound attempt for claim, begin, authorize, renew, observe and settlement with exact metadata and directional whole-message limits | `src/transport/control_grpc.rs` | Injected RPC component corpus covering all six methods, one-attempt failures, metadata/deadline mutations and exact 64/80 KiB boundaries | Implemented over one caller-verified tonic channel. TLS construction and semantic response authorization remain separate composition/protocol slices |
| `services/elitea-worker-python/src/elitea_worker/handlers/agent_events.py` | Ordered SDK callback-to-`NodeEventV1` projection | `src/agents/events.rs` | Ordered differential ordinary/tool/HITL/MCP/skill corpus | Not started |
| `projects/elitea-sdk/elitea_sdk/runtime/**` | Agent assembly, toolsets, skills, MCP, HITL, continuation, and nested execution behavior | Capability-owned modules under `src/agents/`, `src/configurations/`, and `src/toolkits/` | Unit, property, component, and behavioral parity tests | Not started |
| `projects/centry/pylon_indexer/plugins/indexer_worker/**` | Current application/ad-hoc invocation, callback, checkpoint, child dispatch, and indexing behavior | `src/agents/`, `src/compat/`, then `src/indexing/` | Differential fixtures plus cross-process tests | Not started |
| `adk-rust = 2.0.0` published crates | Native agent, graph, toolset, session, checkpoint, MCP, and HITL primitives | Narrow modules under `src/adk/` and capability owners | Compile spikes, component tests, and upstream-bound compatibility tests | Not added |
| This reconstruction | Fail-closed diagnostic with no production registration | `src/capabilities.rs`, `src/lib.rs` | Deterministic JSON and rejection tests | Implemented; transport availability does not enable agent execution |

The tracked mapping will be expanded to source symbols and proving test files as
each slice is implemented. Intentional behavioral improvements and unresolved
contract drift must be recorded explicitly; absence from the table is never
evidence of parity.

## Known contract drift gates

- Current Centry application and ad-hoc handlers consume `truncated_content`,
  but `AgentExecutionInputV1` does not currently carry it. Rust must not invent
  a private field; the language-neutral contract owner must resolve the drift.
- `AgentExecutionTerminalStateV1` declares `PARKED_CHILDREN`, while the currently
  admitted Python/Go execution path does not yet support that state end to end.
  Rust must not advertise parked-child compatibility until cross-language
  delivery and projection tests pass.
