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

The current product-authoring boundary is the EliteaUI flow editor at
`49bac1ba775e5e6d598dea8ccbf328d1d2d20fb3`; the current SDK behavior was
rechecked at `8a8ee3c3cfb1935e88eda6f357b0e89d94a80bbc`. The active add menu is the
authority for the migration blocker, not every historical branch still
accepted by `create_graph`.

## Active UI contract

| Active designer node | Business contract and Rust disposition |
| --- | --- |
| `agent` | Invoke the exact saved application selected on the node. Compile as an ADK child agent/`AgentTool` with separate session/checkpoint lineage; do not rebuild it as an untyped Python-style callback. Pending |
| `code` | Execute editor-authored code. Keep outside the worker process behind a separately supervised sandbox, egress and artifact capability; the current Python network-enabled sandbox is not copied. Pending external runtime |
| `custom` | An editor placeholder whose current SDK execution rejects the node. Preserve that rejection until a concrete typed extension contract exists; it is not a hidden arbitrary-class escape hatch. Implemented rejection |
| `decision` | Ask a model to select one declared route. Compile to a bounded model-backed ADK node plus validated `goto`; model/project authority remains claim-bound. Pending |
| `hitl` | Pause the graph with structured data and resume the exact private checkpoint by a fresh `interrupt_id`. It is distinct from sensitive-tool confirmation and has no tool-call ID. Implemented capability-disabled |
| `llm` | Build a native ADK `LlmAgent` for the node. The node receives only its UI-connected `tool_names`: resolve those names against the claim-authorized toolkit/MCP/application inventory and reject every missing or extra name. It must not inherit the ad-hoc agent's wider tool universe. Nested sensitive-tool/MCP pauses must bind the inner call ID and child session/checkpoint to the outer graph interrupt. Pending next runtime slice |
| `mcp` | Execute the selected MCP tool with its declared state mapping. OAuth/on-demand authorization and sensitive policy remain invocation-bound. Pending |
| `printer` | Publish the declared state value, durably pause after it where configured, then clear the printer marker without duplicating browser output. Pending |
| `router` | Render bounded configured routes from state and choose only a declared target. Pending |
| `state_modifier` | Render one bounded MiniJinja template with the four current SDK filters, update the first declared output using the existing state type, and clear declared variables by type. When its explicit route targets the `END` control-flow sink, that output is also a public-result candidate. Implemented capability-disabled |
| `toolkit` | Execute the exact selected tool from the selected configured toolkit with state input/output mapping. Sensitive-tool policy remains independent of the node label. Pending |

The UI marks `function`, `condition`, `pipeline`, `loop`, `loop_from_tool` and
`tool` deprecated and removes them from the add menu. `END`, `ghost` and
`defaultType` are structural/invisible. They remain compatibility evidence for
saved historical YAML, but they do not displace active-node completion or the
Redis/runtime activation work. Indexer-backed nodes remain last.

## Compiler and node inventory

| Python source branch / symbol | Current observable behavior | Rust target | ADK-Rust 2.0.0 use | Status / deliberate deviation |
| --- | --- | --- | --- | --- |
| `create_graph`: YAML load, state creation, node loop, entry point | Load `state`, state defaults, `entry_point`, `nodes`, interrupts and graph edges | `src/agents/graph/{compiler,yaml}.rs` | `StateGraph`, state channels and reducers | Complete-document compiler implemented for dynamic `hitl` and `state_modifier`. It bounds the YAML at 512 KiB, nodes at 128 and declared state keys at 256; validates state types/defaults, the entry point, references, unique IDs and every route before graph construction; and binds a canonical definition digest. Every other node family and static interrupt fails closed before execution authority is built |
| Node types `function`, `toolkit`, `mcp` -> `FunctionTool` | Map selected state inputs to one direct tool and project declared outputs | `src/agents/graph/nodes/direct_tool.rs`, `src/toolkits/registry.rs` | ADK `Tool` and `Toolset` | Planned; workload credentials and sensitive policy remain Elitea-owned |
| Node type `tool` -> `ToolNode` | Direct selected-tool execution with structured-output option | `src/agents/graph/nodes/tool.rs` | ADK typed tool | Planned |
| Node type `loop` -> `LoopNode` | Repeated tool work and declared state projection | `src/agents/graph/nodes/loop.rs` | ADK loop and graph primitives where semantics match | Planned; ADK's sequential `LoopNodeConfig.parallel` is not true parallelism |
| Node type `loop_from_tool` -> `LoopToolNode` | One tool supplies items and another processes iterations | `src/agents/graph/nodes/loop_from_tool.rs` | ADK custom node plus tools | Planned |
| Node type `indexer` -> `IndexerNode` | Chunk/index tool composition | `src/indexing/graph_node.rs` | ADK custom node around the later indexing capability | Deferred to indexing after agent execution |
| Node type `agent` -> `FunctionTool(Application)` | Invoke a selected saved application as a node | `src/agents/graph/nodes/application.rs` | ADK child agent/session | Planned; distinct from durable subagent fan-out |
| Node types `subgraph`, `pipeline` in the direct-tool branch | Python explicitly rejects these paths and tells callers to use `agent` | `src/agents/graph/nodes/subgraph.rs` only after an admitted contract exists | ADK child `CompiledGraph` | Dead Python code is not copied. A future subgraph feature needs explicit state/checkpoint mapping |
| Node type `code` -> sandbox `FunctionTool` | Execute editor-authored code with network-enabled Python sandbox | Separate code-execution plan and external isolation boundary | ADK action/code shape may inform the adapter | Intentionally not implemented in-process; filesystem, network, CPU/memory and artifact policy are prerequisites |
| Node type `llm` -> `LLMNode` | Model call using only the UI-connected `tool_names`, plus lazy auth/control helpers needed by those selected capabilities | `src/agents/graph/nodes/llm.rs`, `src/agents/assembly.rs` | Nested ADK `LlmAgent`, model and one compiler-restricted `Toolset` | Planned next. Unlike ad-hoc execution, an empty or missing node selection must follow the stored pipeline contract and must not grant every claim-authorized tool. Provider routing and credentials materialize only after authorization; nested tool HITL retains inner call identity and outer checkpoint identity |
| Node types `router`, `decision` | Select one configured route from state or model output | `src/agents/graph/nodes/router.rs` | ADK conditional edges and `NodeOutput::with_goto` | Planned |
| Node type `state_modifier` -> `StateModifierNode` | Apply a declared template, project the first output to the existing state type and clear selected variables | `src/agents/graph/{state_modifier,compiler}.rs` | ADK custom `Node`, state channels and ordinary edges | Implemented capability-disabled. MiniJinja execution is fuel-bounded; source/template/regex/variable counts and serialized result are bounded. `from_json`, `base64_to_string`, `split_by_words` and `split_by_regex` match the active SDK filter surface. Fresh state descriptors/defaults are admitted and resume state wins without reseeding semantic input. `END` remains only a graph sink; when this value-producing node explicitly routes there, its first output becomes a separate public-result candidate projected as one normal browser model turn. Private graph state is never serialized wholesale |
| Node type `printer` plus reset node | Publish printer output, pause after it, then clear its marker | `src/agents/graph/nodes/printer.rs`, `src/agents/hitl.rs` | ADK event plus checkpointed interrupt | Planned; output must pass through `NodeEventV1` and durable ACK |
| Node type `hitl` -> `HITLNode` | Durable user choice, optional state edit and route | `src/agents/graph/{hitl,resume}.rs`, `src/agents/events.rs` | ADK `interrupt_with_data`, graph checkpoint/resume and `goto` | Initial compiler path implemented. A fresh graph agent resolves one Main-authorized decision only against the latest persisted interrupt event and the exact latest checkpoint/thread/pending node/definition digest. Stale, advanced, tampered or already-consumed decisions fail closed; `block_with_comment` follows the configured reject route without publishing the comment |
| Node type `custom` | UI editing placeholder rejected at execution with supported-type guidance | `src/agents/graph/compiler.rs` rejection | None | Preserve rejection; it is not an executable Rust node |
| `transition`, `decision`, `condition` edge blocks | Unconditional or conditional successor selection, including `END` | `src/agents/graph/compiler.rs`, future `src/agents/graph/edges.rs` | ADK edges and `goto` | HITL action routes plus state-modifier transitions and `END` are implemented and validated before graph construction. Decision/condition compilation remains planned |
| `interrupt_before`, `interrupt_after`, printer successor analysis | Pause/resume at the current node or successor without false crash classification | `src/agents/graph/compiler.rs`, future static-interrupt adapter | ADK static interrupts/checkpoints | Explicitly rejected by the initial compiler. Exact browser projection, decision identity and restart semantics must be proven before activation |
| `type: parallel` (absent in Python) | Bounded concurrent branch graphs, wait for all, declared-order result, fail after admitted siblings drain, crash-safe completed-branch reuse | `src/agents/graph/yaml.rs`, `src/agents/graph/parallel.rs`, `src/state/postgres_checkpointer/parallel_children.rs` | Custom ADK `Node`; separately checkpointed child `CompiledGraph` per branch | Core implemented. Full compiler plan construction remains. V1 rejects pausing branches and `wait: one`/`many` |

## Initial active-node compiler slices

`PipelineDefinition::from_yaml` now admits a complete frozen pipeline document,
but only when every executable node is a bounded dynamic `hitl` or
`state_modifier` node.
`AuthorizedNativeAssembly::admit_pipeline` selects only a frozen application
whose `version_details.agent_type` is `pipeline`, validates the complete YAML
before PAT, model, tool or state construction, and retains the claim-bound
runtime/session authorities for the graph assembler. It rejects direct agents,
configured top-level tools and every unsupported node rather than falling
through to the ordinary `LlmAgent` path. A future pipeline LLM node will receive
its own compiler-restricted node toolset; this is not the ad-hoc binding rule.

It derives typed state defaults and channels, builds `START -> entry_point`,
registers every node, validates all action/transition targets and compiles an
invocation-owned ADK `GraphAgent` with an injected `Checkpointer`. A fresh graph
instance can resume the exact latest checkpoint through `PipelineHitlDecision`;
no caller-supplied checkpoint identifier is trusted. Pipeline continuation is
the graph decision contract with an empty tool-call identity; it never passes
through sensitive-tool `require_tool_confirmation`.

The focused corpus reconstructs the graph twice around two sequential pauses
through the real common `Runner` and injected `SessionService`, proves final
completion and one-use decisions, and rejects stale identities and unsupported
node/static-interrupt documents. It also runs active UI-shaped state/default
YAML through the real Runner, covers the four template filters, typed output,
cleaning, exact serialized bound and stable digest, and proves a selected public
result projects as one closed browser model turn. Admission fixtures prove the stored
application selector, graph-decision identity and fail-closed tool/node
boundary. The assembler e2e consumes one state grant, pauses, projects a browser
interrupt, resumes the exact private checkpoint and emits the normal terminal
browser lifecycle.

`NativePipelineStateBackend` consumes the post-authorization session authority
once and derives both PostgreSQL writers from the same immutable claim, fence
and live lease. Conversation events and graph frontier state remain in their
existing separate `elitea_runtime` tables inside `agentstate`; no parallel
interrupt table is introduced. The public chat thread stays presentation data,
while the pseudonymous ADK session ID is the private checkpoint thread and the
interrupt-digest input. The Runner-required resume marker is persisted only in
the private session lineage; the graph input mapper does not turn it into
`input` or `messages`.

`START` and `END` remain only the graph's entry and sink sentinels. A node whose
declared route targets `END` is a predecessor of that sink; its business output
is a separate concern. An all-HITL graph has no public result candidate, so Rust
maps successful completion to the fixed bounded result `Pipeline completed.`.
A `state_modifier` that explicitly routes to `END` contributes its first
declared output as a candidate, encodes a structured value as compact JSON when
needed and projects it through the normal browser model lifecycle. Branching
router/decision nodes may later make a different value-producing predecessor
the executed final node; their compiler slices must extend the candidate set,
not reinterpret the `END` sentinel. No path serializes private graph state or
reproduces the Python `output is None` fallback text. If the process stops after
the Runner appends the continuation event but before the graph advances, exact
suffix recovery still remains an activation gate.

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
