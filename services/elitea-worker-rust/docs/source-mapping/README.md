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
  the capability-closed future explicit pipeline `parallel` node core.
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
  marker is removed before provider dispatch. A fresh direct agent whose
  complete frozen root tool set consists only of saved Applications uses
  ADK-native bounded parallel tool dispatch; mixed tool batches stay sequential.
  The same rule is applied recursively when a saved direct child owns only
  saved Applications. A bounded typed event bus forwards descendant ADK events
  into the parent stream; the projector extends an ordered
  `{name,call_id,sibling_ordinal}` path at every exact container invocation.
  Provider call ID remains invocation identity and ordinal remains presentation
  metadata, so repeated names and concurrently active nested leaves stay
  distinct for current UI grouping. Nested confirmations remain ordinary ADK
  session events under isolated branches. A complete decision set reconstructs
  the exact persisted parent-call chain, replays each admitted direct-agent tier
  through the original call IDs and rejoins the root model. Identical child and
  leaf call IDs under concurrent parents stay scoped by their owning invocation;
  missing siblings, broken parent links and a fourth agent tier fail closed.
  Approved effects and deployment registration remain closed. `native_runtime.rs` selects exactly one direct
  or pipeline assembler before either can redeem authority and keeps both
  completion owners behind the same lifecycle. The pipeline profile separately admits only
  frozen `agent_type=pipeline` applications, compiles their complete YAML before
  provider/state construction and retains the authorized state inputs for the
  graph assembler;
- `src/agents/application_tools.rs`: exact saved child application/version to a
  native child `LlmAgent` behind an ADK-compatible tool, bounded recursive
  assembly, model-visible delegation schema, nested sensitive-policy binding,
  typed descendant-event forwarding and the runtime-name-to-frozen-presentation
  join used by browser projection. The adapter exists because stock ADK
  `AgentTool` buffers child events and cannot expose an exact nested hierarchy.
  Recursive direct-agent confirmation resume uses the root `SessionService`
  transcript and an invocation-scoped replay tree rather than another child
  session or interrupt table. Pipeline Agent-node descendant streaming and
  recursive pipeline checkpoint ownership remain separate gates;
- `src/agents/context_management.rs`: disabled-first seam for SDK context
  settings and future ADK-native compaction through the durable session
  lineage, coordinated with graph checkpoints where applicable;
- `src/agents/graph/{agent,application,compiler,resume,hitl,llm,direct_tool,printer,router,decision,state_modifier,parallel,yaml}.rs`:
  stored-pipeline event identity, complete-document active-node compilation,
  latest-event/checkpoint decision binding, bounded YAML contracts and a
  capability-closed explicit pipeline parallel-node core that is not yet bound
  by the compiler. Direct Toolkit and auth-free remote MCP reads use
  native `ToolContext`; sensitive reads pause before dispatch, approval returns
  the ordinary result, and denial records the same-call blocked result plus the
  SDK-formatted terminal chat message before `goto END` without nulling typed
  outputs. Printer uses a compiler-owned native `interrupt_after` checkpoint,
  publishes one bounded ordinary chat result, and resumes through the generated
  reset node on the next ordinary user message. Router evaluates bounded
  state-driven conditions and Decision runs a no-tool claim-bound model; both
  select only compiler-validated targets with an atomic ADK `goto`. Agent nodes
  map one task to an exact frozen saved participant; direct saved agents reuse
  the claim-bound child-agent assembly, stream their typed descendant events
  under an exact synthetic Application call and project their final response;
  saved pipelines compile as isolated native `SubgraphNode` values over the
  same claim-fenced Checkpointer. A nested dynamic HITL binds one public
  `interrupt_id` to a bounded exact descendant checkpoint chain, resumes every
  pending Agent-node checkpoint in order and keeps child thread/checkpoint IDs
  out of browser output. Sensitive confirmations inside a direct saved Agent
  remain the only public cards; an internal graph interrupt binds their exact
  ID set to the pending Agent node, while approve/reject/block reuses the same
  call-bound application replay coordinator. Parallel nested leaves with the
  same provider call ID remain separated by invocation hierarchy. The current
  materializer supports one selected child
  pipeline level and fails closed if that child declares another Agent node.
  `src/agents/graph/routing_tests.rs` owns their current/legacy YAML, exact
  fallback, normalized-label and common-Runner proof. MCP OAuth/on-demand auth,
  prebuilt/static MCP, remote effects, child variables, nested static Printer
  interrupts, LLM-node nested
  confirmation, arbitrary static interrupts and production activation remain
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
- `src/config.rs` and `src/security.rs`: strict file-only
  `elitea.runtime-deploy.v1` admission, protocol-fixed transport limits,
  canonical private-plane endpoints, permission-bounded regular-file access,
  TLS 1.3 workload identity validation, exact Ed25519 command-key resolution
  and zeroizing spool/Redis secret ownership. Redis password and TLS files are
  reloaded for each connection generation. This is the trust-material boundary,
  not a running bootstrap: channel construction, signal/drain orchestration and
  capability registration remain closed. Production agent registration also
  requires an authoritative frozen runtime/admin `toolkit_security` snapshot;
  an absent policy is never silently interpreted as an empty policy;
- `src/diagnostics.rs`, `src/execution/{agent_delivery_processor,agent_preparation,agent_coordinator,agent_invocation,invocation_supervisor,native_agent_lifecycle,redis_delivery}.rs`:
  crate-scoped subscriber plus authenticated lifecycle/assembly/tool
  correlation. The concrete agent delivery processor now keeps one raw Redis
  PEL owner alive through claim, output preflight, preparation, supervised
  native execution and retirement for both application and ad-hoc commands.
  Normal bootstrap must drain its Redis processing futures before closing the
  coordinator. Export/retention policy and process bootstrap remain
  deployment-owned.

Workspace-relative Python paths are included because the Python sources live in
independent repositories. The Rust targets all live in this package and are
repository-relative to `services/elitea-worker-rust/`.
