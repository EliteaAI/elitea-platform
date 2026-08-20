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

- `src/agents/{native_runtime,assembly,ordinary,pipeline,session,events,sensitive_tools,direct_hitl}.rs`: strict
  frozen-kind routing plus direct
  saved-agent and ad-hoc `LlmAgent` admission, common injected
  `SessionService`/Runner composition, request-independent definition lineage,
  seed-once frozen history, browser event projection, runtime-policy-bound
  sensitive-tool pauses and worker-side exact resolution of Main-authorized
  decisions against raw persisted calls. The ordinary assembler accepts one
  exact continuation before PAT redemption and requires a restorable session.
  Approved reads replay through ADK `RunConfig`/`ToolExecutor`; denied calls
  produce a structured result under the original call ID without dispatching
  the real tool. Exact restart suffixes are recovered and the internal replay
  marker is removed before provider dispatch. Approved effects and deployment
  registration remain closed. `native_runtime.rs` selects exactly one direct
  or pipeline assembler before either can redeem authority and keeps both
  completion owners behind the same lifecycle. The pipeline profile separately admits only
  frozen `agent_type=pipeline` applications, compiles their complete YAML before
  provider/state construction and retains the authorized state inputs for the
  graph assembler;
- `src/agents/application_tools.rs`: exact saved child application/version to
  ADK `AgentTool` composition, recursion and model-visible delegation schema;
- `src/agents/context_management.rs`: disabled-first seam for SDK context
  settings and future ADK-native compaction through the durable session
  lineage, coordinated with graph checkpoints where applicable;
- `src/agents/graph/{agent,compiler,resume,hitl,parallel,yaml}.rs`:
  stored-pipeline graph event identity, the complete-document HITL-only
  compiler, exact latest-event/checkpoint decision binding, bounded YAML node
  contracts and the durable parallel-node core. General LLM/tool/MCP/parallel
  node compilation, static interrupts and production PostgreSQL assembly remain
  separate gates;
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
  `migrations/agentstate/0002_agent_sessions.sql`: bounded claim-fenced ADK
  conversation/session persistence for direct and graph Runners. Direct
  sensitive confirmations remain standard ADK events: Runner awaits persistence
  before yielding them to browser projection, so no duplicate pending-interrupt
  table is introduced;
- `src/protocol/control.rs::ClaimBoundSessionAuthority`: one-use session-writer
  grant minted only at `AUTHORIZED_NOW`, independently of output and settlement
  authority;
- `src/execution/agent_lease.rs` and `src/state/writer_lease.rs`: the supervised
  Main claim lease becomes a read-only state-writer guard. Main's accepted
  control receipt supplies the database-authored claim start used to order
  writer takeover in the separate state database;
- `src/state/postgres_checkpointer.rs` plus Main migration
  `migrations/agentstate/0001_agent_graph_checkpoints.sql`: graph-only frontier,
  node-state and interrupt persistence. Both adapters target the same separate
  PostgreSQL `agentstate` database under an isolated `elitea_runtime` schema,
  leaving legacy LangGraph tables in `public` unchanged. They implement
  distinct ADK contracts rather than duplicating transcript state. State writes
  check the supervised lease before locking and before commit, then retain a
  durable newer-writer fence. This does not claim an atomic transaction across
  Main and `agentstate`; cleanup-owner coverage remains a deployment gate;
- current native storage is seven runtime tables: two graph-checkpoint tables
  and five normalized session tables. `elitea_runtime.schema_migrations` is an
  eighth physical bookkeeping table, not session state. The four legacy
  LangGraph tables remain untouched. Future app/user/session-state
  consolidation is a measured storage optimization; parallel or nested HITL
  must use distinct session/checkpoint identities rather than new tables per
  pause scope;
- `src/diagnostics.rs`, `src/execution/{agent_preparation,agent_coordinator,agent_invocation,invocation_supervisor,native_agent_lifecycle}.rs`:
  crate-scoped subscriber plus authenticated lifecycle/assembly/tool
  correlation. Export/retention policy remains deployment-owned.

Workspace-relative Python paths are included because the Python sources live in
independent repositories. The Rust targets all live in this package and are
repository-relative to `services/elitea-worker-rust/`.
