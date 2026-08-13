# ADK-Rust 2.0.0 integration audit

- Published version: `2.0.0`
- Tag commit: `e1b4226e19ab0b41eb7026812ab0bbf8886e9b6f`
- License: Apache-2.0
- Edition: Rust 2024
- Upstream MSRV: Rust 1.95
- Elitea worker pin policy: exact `=2.0.0`, explicit features, committed lockfile

Primary source is the immutable upstream `v2.0.0` tag and the published crates,
not upstream `main` or an unversioned docs snapshot.

## Integration decision

Use ADK-Rust for internal agent, graph, runner, toolset, session, checkpoint,
MCP, event and artifact primitives. Do not use it for Elitea's signed worker
command, claim/lease/fence protocol, tenant authority, durable output delivery,
settlement, current browser event contract, credential grants or migration
policy.

The dependency is now pinned and locked with defaults disabled. The first
compile/behavior slice enables only the provider-neutral execution substrate:

```toml
adk-rust = { version = "=2.0.0", default-features = false,
  features = ["agents", "runner", "sessions", "models", "graph", "tools"] }
```

`models` exposes provider-neutral model contracts and `MockLlm`; it does not
enable a network provider. Production provider, PostgreSQL session/checkpoint,
MCP, artifacts, skills and CodeAct features remain separate reviewed changes.
In particular, enabling the default `minimal` preset would silently add Gemini,
so it is intentionally disabled.

ADK's umbrella crate does not forward the runner's `context-compaction`
feature. If selected after parity tests, add an exact direct `adk-runner`
dependency to unify that feature. Do not enable `standard`, `enterprise` or
`full` as a shortcut.

The worker still reports no production capability. The dependency and native
behavior tests prove library compatibility only; they do not cross the Elitea
claim/authorization fence or enable agent execution.

## Current native proof

`tests/adk_native_primitives.rs` exercises the exact façade dependency rather
than importing ADK component crates directly:

- `MockLlm` -> `LlmAgent` -> `InMemorySessionService` -> `Runner` produces an
  event stream without provider credentials;
- `FunctionTool` is discovered through `BasicToolset` and invoked with an exact
  function-call identity;
- a `StateGraph` forks into unequal branches and a deferred fan-in runs exactly
  once after both branches complete;
- a four-node frontier configured with `with_max_concurrency(2)` admits at most
  two node bodies until permits are released.

These are component-level proofs. They do not establish production provider,
PostgreSQL, Redis, HITL, MCP, artifact, restart or load behavior.

## Primitive map

| Elitea need | ADK-Rust 2.0 primitive | Integration rule |
| --- | --- | --- |
| Agent runtime | `Runner`, `RunnerConfig`, `Agent`, `LlmAgent` | Wrap behind admitted Elitea request/result types; Runner is not the durable worker lifecycle |
| Fixed sequential/loop workflows | `SequentialAgent`, `LoopAgent` | Use when current pipeline semantics match; retain Elitea YAML and policy adapter |
| Fixed parallel agents | `ParallelAgent` | Add an outer capacity policy; it has no maximum-concurrency argument and is not fail-fast |
| Static graph fork/join | `StateGraph`, multiple outgoing edges, deferred fan-in, `CompiledGraph::with_max_concurrency` | Preferred true pipeline parallel-node implementation |
| Dynamic parallel collection | Custom `Node`, `NodeContext::run_node_with`, stable `RunNodeOptions::with_run_id` | Bound with `buffer_unordered(N)` or a semaphore and sort results before state reduction |
| Tools | `Tool`, `Toolset`, `BasicToolset`, typed `#[tool]` | Prefer typed tool macro; `FunctionTool` raw JSON is not automatic schema validation. Elitea still owns tool identity, grants, policy and result projection |
| Conversation state | `SessionService`, `Session` | Implement or wrap storage to meet Elitea ordering, metadata and concurrency requirements |
| Graph checkpoints | `Checkpointer`, `SqliteCheckpointer` as behavioral reference | Implement PostgreSQL for new Rust lineages; add Elitea scoping/fencing outside the trait |
| Remote MCP | `McpToolset`, `McpHttpClientBuilder`, `McpServerManager` | Keep stdio outside the main worker; prefix names per server and bound connections/concurrency |
| Durable HITL | Graph interrupts/checkpoints; possibly CodeAct/Monty for interpreter continuation | Do not rely solely on ordinary LLM tool confirmation |
| Events | `Event`, `EventActions` | Project into Elitea-owned ordered `NodeEventV1`; partial ADK events are transient |
| Artifacts | `Artifacts`, `ArtifactService` | Store bytes through Elitea object/artifact boundary with transactional unique versioning |

## Parallel execution constraints

Static pipeline parallelism is a real graph topology:

```text
fan-out
  -> branch A
  -> branch B
  -> branch C
deferred fan-in
```

The graph must apply a configured maximum concurrency and explicit reducers.
Conditional fan-in is not inferred; the compiler must declare the join. Dynamic
collections need stable item identities, bounded execution, deterministic output
ordering, checkpointed completion and idempotent/generation-fenced effects.

Do not use ADK `LoopNodeConfig.parallel` as the implementation: the 2.0.0 loop
executor is sequential despite that field. Do not rely blindly on
`WorkflowSchema::build_graph`: the schema contains agent declarations, but that
builder registers action nodes only.

Avoid pausing for confirmation inside a parallel frontier until all sibling
effects are replay-safe. The executor can drain sibling futures before it sees
an interrupt yet return before applying their state, making resume re-execution
possible.

ADK-Rust 2.0.0 does not yet make its deferred fan-in durable. The executor's
`pending_deferred` tracker and timeout start instants are process memory, while
the native `Checkpoint` persists state, pending nodes, step, cleared interrupt,
attempts and the child ledger. A crash after the short side of an unequal fork
has reached a deferred join can therefore restore only the still-pending long
branch and lose the earlier arrival. Elitea will solve that at its adapter
boundary by storing a versioned fan-in ledger in native checkpoint state and
reconstructing it before graph resume. The restart-between-arrivals test is a
production blocker for the new node.

The first YAML `parallel` node will consequently expose only `wait: all` with a
bounded maximum concurrency, stable branch IDs, deterministic reduction and a
fail-after-drain error policy. The action-layer `WaitAny` and `WaitN` modes are
state collectors after a frontier has already completed; they are not an
early-release scheduler. `wait: one` and `wait: many` stay rejected until an
Elitea scheduler durably records the completed set and absolute deadline and
defines replay-safe sibling cancellation. ADK `ParallelAgent` remains a
separate primitive for fixed subagents and does not implement this graph node.

## PostgreSQL checkpointer implementation

The native `adk_graph::Checkpointer` contract is the target, not the current
LangGraph blob schema. Its operations are `save`, latest-by-thread `load`,
`load_by_id`, thread `list`, thread `delete`, and retention `prune`. The bundled
SQLite implementation is the behavioral reference. Elitea's PostgreSQL backend
keeps tenant/thread authorization and generation fencing around this
deliberately small trait.

The worker now implements the exact ADK-Rust 2.0.0 `Checkpointer` trait in
`src/state/postgres_checkpointer.rs`. Main migration
`0064_agent_graph_checkpoints.sql` owns a new `adk-graph.2.0.0.v1` lineage. It
deliberately does not read, write, copy or pickle LangGraph checkpoint tuples or
blob tables.

The implementation preserves the complete
checkpoint model demonstrated by `SqliteCheckpointer`:

- thread and checkpoint IDs;
- complete JSON state;
- step and pending frontier;
- metadata and creation time;
- cleared interrupt state;
- retry attempts;
- child-execution ledger.

The fields are stored directly as bounded canonical JSON text plus
TIMESTAMPTZ. Text follows the SQLite baseline and preserves accepted
arbitrary-precision JSON number spellings that PostgreSQL JSONB would
normalize or reject. PostgreSQL `IS JSON` constraints validate the container
shapes, while a canonical RFC3339 companion retains nanoseconds that PostgreSQL
timestamps cannot represent. A writer-serialized save ordinal preserves ADK
append order even when creation timestamps tie or move backwards. Duplicate
identical saves are idempotent, changed payload under the same ID conflicts,
and pruning is set based and uses the database clock.

One adapter is activated from an opaque current claim for exactly one tenant,
resource project, projection project, capability, graph-definition digest and
thread. Every operation locks and rechecks Main's unreleased, unexpired claim,
`MAY_HAVE_STARTED` invocation state, generation, attempt, lease epoch, workload
session, producer and the full 32-byte fence token. The token is zeroized with
its Rust owner and is never persisted in checkpoint tables. A newer claim
fences the old adapter; deleting checkpoint history deliberately retains the
writer row so deletion cannot resurrect stale authority.

The adapter receives a caller-owned `PgPool`; it never opens a pool per agent or
per checkpoint. Each operation borrows a pooled connection through a SQLx
transaction and returns it on commit or cancellation/drop. Deployment owns the
single bounded pool, acquisition timeout, statement/lock timeouts, credentials
and connection metrics. Hard row/frontier/map/depth/node/thread-count and
retained-byte limits are enforced in Rust and the migration before restore can
allocate an unbounded structure.

Errors have a stable data-free code, bounded operator message and explicit
retryability. Connection, TLS, pool, serialization/deadlock/lock-timeout and
server-shutdown classes are retryable; schema, constraint, decode and other
programming/data failures are not. The raw SQLx cause is available only through
the trusted error source for the owning tracing boundary.

Explicit ADK resume can look up a checkpoint by checkpoint ID without proving
it belongs to the requested thread. The Elitea boundary must authorize and bind
tenant/thread/checkpoint identity before calling the executor, and the adapter
must reject a mismatched returned checkpoint.

Checkpointing remains at-least-once around external effects. An effect completed
before its superstep checkpoint can repeat after a crash, so mutation tools need
stable effect identities and effect-boundary deduplication/fencing.

The isolated PostgreSQL 18 component test applies the real migration and proves
complete-field/nanosecond/arbitrary-number round trip, exact-save replay,
save-order preservation across timestamp ties, wrong-thread isolation,
graph-definition isolation, release-race/newer-claim fencing, prune/delete and
reuse of a four-connection pool. Production composition still
must derive the graph-definition digest from the admitted immutable graph,
authorize existing Python lineages for Python-only continuation or explicit
migration, grant a restricted worker database role, and run the same test on
Linux CI and the deployed pooler.

## Session and compaction constraints

The built-in `PostgresSessionService` is not the authoritative Elitea transcript
store without additional work:

- history limits are applied after an unbounded matching-event query;
- corrupt events are silently omitted during deserialization;
- stored events omit `llm_request` and `provider_metadata`;
- timestamp-only ordering lacks a deterministic tie-breaker;
- state updates can lose concurrent deltas;
- migration advisory locking is not held on one pinned connection.

Compaction must preserve tool-call/result pairing and durable continuation. ADK
has post-run summaries, intra-run heuristic compaction and a feature-gated
runner compactor, but the latter two do not remove persisted originals. Elitea
will select a versioned compacted representation only after transcript,
checkpoint and resume tests pass.

## Tool and MCP constraints

- Tool execution strategy must be explicit. ADK `Parallel` is not inherently
  bounded, and per-tool concurrency configuration can bypass the global
  semaphore instead of composing with it.
- Queue wait and retry delay are outside the tool execution timeout; Elitea's
  absolute deadline must wrap the full operation.
- Calls through one `McpToolset` are effectively serialized because its client
  mutex is held across invocation. Real safe concurrency requires bounded
  independent connections/toolsets.
- ADK OAuth covers client credentials but not the complete Elitea delegated
  authorization-code/PKCE/discovery/refresh flow.
- MCP call replay remains disabled unless a tool is proven read-only and
  idempotent.
- MCP task `InputRequired` is not durable application HITL; keep Elitea's
  explicit pause/continuation contract.

ADK tool confirmation and graph HITL are related but distinct primitives.
`RunConfig` confirmation decisions are keyed by `function_call_id`, with an
optional canonical argument fingerprint. That matches Elitea's requirement
that an identical tool name and arguments can still be a new invocation. Graph
interrupt-before/after and dynamic interrupts, together with a checkpoint, are
the durable pause/resume substrate. The Elitea adapter must bind either path to
the current `interrupt_id`; it must never authorize by tool name and arguments
alone.

## Redis ownership

Redis is still required for the Elitea worker. Redis Streams own durable command
intake, pending-entry reclaim/heartbeat and the final atomic `XACK` + `XDEL` +
delivery-index removal. The already implemented strict delivery decoder and
retirement authority are only the contract boundary; a TLS/ACL client, stream
consumer/reclaimer and restricted Lua effect still require component and
restart proof.

ADK graph/session Redis features are optional execution-state backends and do
not replace that delivery transport. They are not enabled in the current
feature set. Any later ADK Redis use must have separate keys, ownership,
retention and failure semantics from Elitea command delivery.

## Errors, tracing and performance

ADK errors remain internal causes. Elitea adapters must map them once into
stable operator codes, retryability and bounded safe messages, retain the source
for the owning tracing boundary, and never copy provider bodies, prompts,
credentials, checkpoint state or raw dependency errors across a trust boundary.
Low-level code should not repeatedly log an error that the orchestration owner
will record.

Tracing is designed with each execution slice, even where export plumbing is
deferred. Spans need stable execution, generation, claim-attempt, capability,
agent/node/tool and function-call identifiers; secret values and high-cardinality
payloads are excluded. ADK's own instrumentation is useful below this boundary,
but Elitea owns the lifecycle span that correlates admission, authorization,
ADK execution, durable output, settlement and Redis retirement.

The scalability design is bounded async admission, resource-specific limits,
single-owner delivery state and graph/tool concurrency ceilings. `smallvec`,
`crossbeam` or custom lock-free structures are not added speculatively. They are
appropriate only after representative profiles identify a hot allocation or
contention point and a benchmark proves the replacement improves the complete
worker workload without weakening cancellation, backpressure or durability.

## Required compile and behavior spikes

1. **Complete:** exact dependency/features, locked build, native model/agent/
   session/runner execution and toolset invocation.
2. **Complete foundation:** static graph fork/join with unequal branch lengths,
   bounded active count, deterministic result and exactly one join. Production
   graph compilation, checkpoint/restart, error policy and HITL remain later
   integration gates.
3. Dynamic 100-item node with bounded concurrency, stable run IDs and restart.
4. **Complete storage primitive:** PostgreSQL full-field/nanosecond round trip,
   deterministic latest, exact retry, prune/delete, wrong-thread and graph
   isolation, newer-claim fencing and pool reuse. Restricted-role/pooler load,
   Linux CI, invocation composition and restart fan-in remain production gates.
5. Session metadata fidelity, SQL-bounded history, deterministic order,
   concurrent deltas, corrupt-event visibility and compaction reconstruction.
6. MCP HTTP plus external stdio runner, OAuth expiry/401, reconnect without
   duplicate mutation, cancellation, name prefixing and measured connection
   concurrency.
7. Provider-specific confirmation identity, duplicate-effect prevention, graph
   interrupt/restart and CodeAct/Monty continuation where selected.
8. Ordered `NodeEventV1` projection and transactional artifact versioning.

Upstream audit evidence on the immutable tag: 53 focused upstream tests passed
and 2 external-server MCP tests were ignored. This is upstream-library evidence,
not Elitea integration proof.
