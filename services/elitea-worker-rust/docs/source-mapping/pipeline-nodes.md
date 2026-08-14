# Python pipeline graph to Rust mapping

This ledger maps the current `elitea-sdk` pipeline compiler and worker runtime
evidence to the Rust files that replace it. It is traceability, not a plan to
copy Python's class structure. Rust uses ADK-Rust 2.0.0 where it preserves the
admitted behavior and adds small Elitea boundaries for YAML compatibility,
authority, durability and policy.

Primary Python evidence is
`elitea_sdk/runtime/langchain/langraph_agent.py::create_graph`. Worker-side
input, lease, output and continuation contracts remain mapped in
`agent-runtime.md`. Python currently has no `parallel` node; that row is an
intentional product addition requested for the Rust runtime.

## Compiler and node inventory

| Python source branch / symbol | Current observable behavior | Rust target | ADK-Rust 2.0.0 use | Status / deliberate deviation |
| --- | --- | --- | --- | --- |
| `create_graph`: YAML load, state creation, node loop, entry point | Load `state`, `entry_point`, `nodes`, interrupts and graph edges | `src/agents/graph/compiler.rs`, `src/agents/graph/yaml.rs` | `StateGraph`, state channels and reducers | Compiler planned. `yaml.rs` currently implements only the strict `parallel` mapping; the parser is bounded and rejects unknown fields |
| Node types `function`, `toolkit`, `mcp` -> `FunctionTool` | Map selected state inputs to one direct tool and project declared outputs | `src/agents/graph/nodes/direct_tool.rs`, `src/toolkits/registry.rs` | ADK `Tool` and `Toolset` | Planned; workload credentials and sensitive policy remain Elitea-owned |
| Node type `tool` -> `ToolNode` | Direct selected-tool execution with structured-output option | `src/agents/graph/nodes/tool.rs` | ADK typed tool | Planned |
| Node type `loop` -> `LoopNode` | Repeated tool work and declared state projection | `src/agents/graph/nodes/loop.rs` | ADK loop and graph primitives where semantics match | Planned; ADK's sequential `LoopNodeConfig.parallel` is not true parallelism |
| Node type `loop_from_tool` -> `LoopToolNode` | One tool supplies items and another processes iterations | `src/agents/graph/nodes/loop_from_tool.rs` | ADK custom node plus tools | Planned |
| Node type `indexer` -> `IndexerNode` | Chunk/index tool composition | `src/indexing/graph_node.rs` | ADK custom node around the later indexing capability | Deferred to indexing after agent execution |
| Node type `agent` -> `FunctionTool(Application)` | Invoke a selected saved application as a node | `src/agents/graph/nodes/application.rs` | ADK child agent/session | Planned; distinct from durable subagent fan-out |
| Node types `subgraph`, `pipeline` in the direct-tool branch | Python explicitly rejects these paths and tells callers to use `agent` | `src/agents/graph/nodes/subgraph.rs` only after an admitted contract exists | ADK child `CompiledGraph` | Dead Python code is not copied. A future subgraph feature needs explicit state/checkpoint mapping |
| Node type `code` -> sandbox `FunctionTool` | Execute editor-authored code with network-enabled Python sandbox | Separate code-execution plan and external isolation boundary | ADK action/code shape may inform the adapter | Intentionally not implemented in-process; filesystem, network, CPU/memory and artifact policy are prerequisites |
| Node type `llm` -> `LLMNode` | Model call, selected tools, lazy registry, middleware and application tools | `src/agents/graph/nodes/llm.rs`, `src/agents/assembly.rs` | ADK `LlmAgent`, model and toolsets | Planned; provider routing and credentials materialize only after authorization |
| Node types `router`, `decision` | Select one configured route from state or model output | `src/agents/graph/nodes/router.rs` | ADK conditional edges and `NodeOutput::with_goto` | Planned |
| Node type `state_modifier` -> `StateModifierNode` | Apply a declared template and remove selected variables | `src/agents/graph/nodes/state_modifier.rs` | ADK custom node/reducers | Planned with closed mappings and bounded templates |
| Node type `printer` plus reset node | Publish printer output, pause after it, then clear its marker | `src/agents/graph/nodes/printer.rs`, `src/agents/hitl.rs` | ADK event plus checkpointed interrupt | Planned; output must pass through `NodeEventV1` and durable ACK |
| Node type `hitl` -> `HITLNode` | Durable user choice, optional state edit and route | `src/agents/hitl.rs`, `src/agents/graph/nodes/hitl.rs` | ADK interrupt/checkpoint | Planned; a decision binds the current interrupt ID, never tool name and arguments alone |
| Node type `custom` | UI editing placeholder rejected at execution with supported-type guidance | `src/agents/graph/compiler.rs` rejection | None | Preserve rejection; it is not an executable Rust node |
| `transition`, `decision`, `condition` edge blocks | Unconditional or conditional successor selection, including `END` | `src/agents/graph/compiler.rs`, `src/agents/graph/edges.rs` | ADK edges and `goto` | Planned with target validation before execution |
| `interrupt_before`, `interrupt_after`, printer successor analysis | Pause/resume at the current node or successor without false crash classification | `src/agents/hitl.rs`, `src/agents/graph/compiler.rs` | ADK static interrupts/checkpoints | Planned; exact current interrupt identity remains Elitea-owned |
| `type: parallel` (absent in Python) | Bounded concurrent branch graphs, wait for all, declared-order result, fail after admitted siblings drain, crash-safe completed-branch reuse | `src/agents/graph/yaml.rs`, `src/agents/graph/parallel.rs`, `src/state/postgres_checkpointer/parallel_children.rs` | Custom ADK `Node`; separately checkpointed child `CompiledGraph` per branch | Core implemented. Full compiler plan construction remains. V1 rejects pausing branches and `wait: one`/`many` |

## Parallel YAML v1

```yaml
- id: gather
  type: parallel
  branches:
    - id: source_a
      node: fetch_a
    - id: source_b
      node: fetch_b
  max_concurrency: 2
  wait: all
  error_policy: fail_after_drain
  output: [gathered]
  transition: summarize
```

The future UI card can expose exactly these fields. Bounds are 2-64 branches,
maximum concurrency 1-32 and exactly one output channel. Branch IDs are stable
and unique. Results are arrays in declared order, each carrying `branch_id`,
`node` and `result`.

ADK action `WaitAll` is not invoked directly because it treats every current
`branch:*` state key as complete and iterates hash-map order. `WaitAny` and
`WaitN` likewise do not schedule early completion. They remain useful framework
evidence, while the Elitea adapter owns the immutable expected set, durable
child identity and deterministic projection.

Each branch is compiled as a small child graph and receives an opaque,
claim-fenced descendant checkpoint thread bound to its bounded canonical
projected-input digest. Its terminal checkpoint is saved before the branch
returns. A restart with the same input loads finished branches without running
their nodes again; changed input creates a new child lineage, and only
unfinished or failed same-input branches execute. A later loop visit differs by
the checkpointed parent step. Pausing branches stay compile-rejected until the
current-interrupt decision and outer publication are covered by one durable
state machine.
