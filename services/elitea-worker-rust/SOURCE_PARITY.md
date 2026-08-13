# Rust worker source parity

- Status: reconstruction foundation only
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

| Source evidence | Observable responsibility | Rust target | Proof | Status |
| --- | --- | --- | --- | --- |
| `libs/proto/elitea/runtime/v1/*.proto` | Language-neutral worker command, input, output, control, and settlement contracts | `src/protocol/` | Cross-language binary fixtures and strict parser tests | Not started |
| `services/elitea-worker-python/src/elitea_worker/protocol/agent.py` | Strict `AgentExecutionInputV1` parsing and result binding | `src/agents/protocol.rs` | Differential application/ad-hoc contract tests | Not started |
| `services/elitea-worker-python/src/elitea_worker/handlers/agent.py` | Select application versus ad-hoc semantic entry point | `src/agents/request.rs` | Unit tests for both entry points | Not started |
| `services/elitea-worker-python/src/elitea_worker/handlers/agent_events.py` | Ordered `NodeEventV1` projection | `src/compat/node_events.rs` | Ordered differential event corpus | Not started |
| `projects/elitea-sdk/elitea_sdk/runtime/**` | Agent assembly, toolsets, skills, MCP, HITL, continuation, and nested execution behavior | Capability-owned modules under `src/agents/`, `src/configurations/`, and `src/toolkits/` | Unit, property, component, and behavioral parity tests | Not started |
| `projects/centry/pylon_indexer/plugins/indexer_worker/**` | Current application/ad-hoc invocation, callback, checkpoint, child dispatch, and indexing behavior | `src/agents/`, `src/compat/`, then `src/indexing/` | Differential fixtures plus cross-process tests | Not started |
| `adk-rust = 2.0.0` published crates | Native agent, graph, toolset, session, checkpoint, MCP, and HITL primitives | Narrow modules under `src/adk/` and capability owners | Compile spikes, component tests, and upstream-bound compatibility tests | Not added |
| This reconstruction | Fail-closed diagnostic with no production registration | `src/capabilities.rs`, `src/lib.rs` | Deterministic JSON and rejection tests | Implemented |

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
