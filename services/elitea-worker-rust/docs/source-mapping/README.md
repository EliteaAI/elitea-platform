# Source-to-Rust mapping

These ledgers map observable Elitea behavior to concrete Rust ownership. They
are compatibility evidence, not a byte-for-byte port plan.

The evidence has three equal, complementary implementation sources:

1. the current platform Python worker owns the executable interpretation of the
   language-neutral protobuf contracts, control/output gRPC lifecycle,
   `NodeEventV1` bridge, result/artifact binding, delivery fencing, spool replay
   and settlement;
2. `elitea-sdk` owns most agent, configuration, toolkit and indexing business
   behavior;
3. Centry `indexer_worker` owns current application/ad-hoc invocation,
   continuation, callback, orchestration, indexing and UI-compatibility behavior.

The `.proto` files are the schema authority, but schema inspection alone is not
enough: the Python worker's validators, lifecycle code and tests define how the
contract is safely executed today.

Source snapshot used for the initial reconstruction inventory:

| Source | Revision |
| --- | --- |
| `elitea-platform` language-neutral contracts and Python worker | `4a553cee4302c863a562232f1b6b9964d5237357` |
| `elitea-sdk` | `fd6c01be2afcc696cce68b430fa1d89ddba3ae21` |
| Centry `indexer_worker` | `67d65b0dbbb8dbe2d590e8ecfe8ec13cd96998fa` |

Every implementation slice must update its rows in the same commit. Status has
one of these meanings:

- `planned`: target ownership is proposed, but the Rust file does not yet
  exist;
- `foundation`: the file exists and proves only the behavior named in the row;
- `partial`: some observable behavior is implemented, with missing gates listed;
- `blocked`: the current language-neutral or cross-service contract cannot
  express or consume the behavior end to end;
- `ported`: all named behavior, policy, error, cancellation, and differential
  tests pass;
- `intentional deviation`: Rust deliberately improves or retires an
  implementation detail while preserving the documented product contract.

A row is never `ported` based only on compilation or final-answer similarity.
The proof must cover the relevant wire shape, state transition, event ordering,
authorization, failure behavior, and recovery boundary.

Detailed ledgers:

- `agent-runtime.md` maps language-neutral worker delivery and agent execution.
- `pipeline-nodes.md` maps every current Python pipeline node/edge branch and
  the new durable Rust `parallel` node.
- `configuration-toolsets.md` maps saved configuration and toolkit families.
- `indexing.md` maps indexing behavior and its later Rust capability.

Maintained Rust runtime ownership registry:

- `src/agents/{assembly,ordinary,session,events,sensitive_tools}.rs`: direct
  saved-agent and ad-hoc `LlmAgent` admission, common injected
  `SessionService`/Runner composition, seed-once frozen history, browser event
  projection and runtime-policy-bound sensitive-tool pauses;
- `src/agents/application_tools.rs`: exact saved child application/version to
  ADK `AgentTool` composition, recursion and model-visible delegation schema;
- `src/agents/context_management.rs`: disabled-first seam for SDK context
  settings and future ADK-native compaction through the durable session
  lineage, coordinated with graph checkpoints where applicable;
- `src/agents/graph/{agent,hitl,parallel,yaml}.rs`: stored-pipeline graph event
  identity, bounded YAML node contracts, dynamic HITL routing and the durable
  parallel-node core; the whole-pipeline compiler remains a separate gate;
- `src/toolkits/{snapshot,materialize,invocation,policy}.rs`: frozen configured,
  MCP and application references, native family toolsets and generic bounded
  call policy/tracing;
- `src/transport/model_facade.rs`: provider-neutral model ownership over
  `model_gateway.rs` and `anthropic_gateway.rs`, including frozen
  `model_project_id` authority;
- `src/transport/platform_client.rs`: claim-bound application/version lookup
  today and future artifact grants; `runtime_context.rs` owns the concrete
  private transport;
- `src/state/postgres_session.rs` plus Main migration
  `migrations/shared/0065_agent_sessions.sql`: bounded claim-fenced ADK
  conversation/session persistence for direct and graph Runners;
- `src/protocol/control.rs::ClaimBoundSessionAuthority`: one-use session-writer
  grant minted only at `AUTHORIZED_NOW`, independently of output and settlement
  authority;
- `src/state/postgres_checkpointer.rs` plus Main migration
  `migrations/shared/0064_agent_graph_checkpoints.sql`: graph-only frontier,
  node-state and interrupt persistence. Both adapters use the existing
  PostgreSQL `agentstate` schema and the same execution authority, but implement
  distinct ADK contracts rather than duplicating transcript state;
- `src/diagnostics.rs`, `src/execution/{agent_preparation,native_agent_lifecycle}.rs`:
  crate-scoped subscriber plus authenticated lifecycle/assembly/tool
  correlation. Export/retention policy remains deployment-owned.

Workspace-relative Python paths are included because the Python sources live in
independent repositories. The Rust targets all live in this package and are
repository-relative to `services/elitea-worker-rust/`.
