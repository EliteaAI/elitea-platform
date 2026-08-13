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

The dependency will be introduced with a compile spike before any production
capability is advertised. The expected feature floor is:

```toml
adk-rust = {
  version = "=2.0.0",
  default-features = false,
  features = [
    "agents",
    "runner",
    "sessions",
    "postgres-session",
    "graph",
    "tools",
    "mcp",
    "mcp-http",
    "artifacts",
    "codeact-monty",
    # Add exactly one reviewed model-provider feature.
  ],
}
```

ADK's umbrella crate does not forward the runner's `context-compaction`
feature. If selected after parity tests, add an exact direct `adk-runner`
dependency to unify that feature. Do not enable `standard`, `enterprise` or
`full` as a shortcut.

## Primitive map

| Elitea need | ADK-Rust 2.0 primitive | Integration rule |
| --- | --- | --- |
| Agent runtime | `Runner`, `RunnerConfig`, `Agent`, `LlmAgent` | Wrap behind admitted Elitea request/result types; Runner is not the durable worker lifecycle |
| Fixed sequential/loop workflows | `SequentialAgent`, `LoopAgent` | Use when current pipeline semantics match; retain Elitea YAML and policy adapter |
| Fixed parallel agents | `ParallelAgent` | Add an outer capacity policy; it has no maximum-concurrency argument and is not fail-fast |
| Static graph fork/join | `StateGraph`, multiple outgoing edges, deferred fan-in, `CompiledGraph::with_max_concurrency` | Preferred true pipeline parallel-node implementation |
| Dynamic parallel collection | Custom `Node`, `NodeContext::run_node_with`, stable `RunNodeOptions::with_run_id` | Bound with `buffer_unordered(N)` or a semaphore and sort results before state reduction |
| Tools | `Tool`, `Toolset`, `BasicToolset`, typed `#[tool]` | Prefer typed tool macro; `FunctionTool` raw JSON is not automatic schema validation |
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

## PostgreSQL checkpointer requirements

The PostgreSQL implementation of ADK `Checkpointer` must preserve the complete
checkpoint model demonstrated by `SqliteCheckpointer`:

- thread and checkpoint IDs;
- complete JSON state;
- step and pending frontier;
- metadata and creation time;
- cleared interrupt state;
- retry attempts;
- child-execution ledger.

Use JSONB/TIMESTAMPTZ, one transaction per save/prune operation, deterministic
latest ordering and set-based pruning. Add Elitea-owned tenant and authenticated
thread scoping, generation/lease fencing, conflict control and migrations.

Explicit ADK resume can look up a checkpoint by checkpoint ID without proving
it belongs to the requested thread. The Elitea boundary must authorize and bind
tenant/thread/checkpoint identity before calling the executor, and the adapter
must reject a mismatched returned checkpoint.

Checkpointing remains at-least-once around external effects. An effect completed
before its superstep checkpoint can repeat after a crash, so mutation tools need
stable effect identities and effect-boundary deduplication/fencing.

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

## Required compile and behavior spikes

1. Exact dependency/features plus `cargo tree -e features` and locked build.
2. Static graph fork/join with unequal durations, bounded active count,
   deterministic reducer and exactly one join.
3. Dynamic 100-item node with bounded concurrency, stable run IDs and restart.
4. PostgreSQL full-field round trip, deterministic latest, prune/delete,
   rollback, wrong-thread rejection, tenant isolation, concurrent writers and
   generation fencing.
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
