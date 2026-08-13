# Agent runtime source mapping

This ledger covers both `agent.execute.application.v1` and
`agent.execute.adhoc.v1`. The language-neutral protocol remains Elitea-owned;
ADK-Rust is an internal execution substrate.

The platform Python worker is the executable contract reference for protobuf
input/output, control and output gRPC, `NodeEventV1` bridging, terminal result
binding, delivery fencing and replay. Rust parity therefore compares behavior
with both the schema and this Python implementation, not only with generated
message fields.

## Protocol and delivery

| Source path and symbol | Observable behavior | Rust target | ADK-Rust role | Proving tests | Status / deviation |
| --- | --- | --- | --- | --- | --- |
| `libs/proto/elitea/runtime/v1/{agent,command,envelope,input}.proto` | Reference-only signed command and bounded application/ad-hoc input | `build.rs`, `src/protocol/mod.rs`, `src/agents/protocol.rs` | None | `tests/agent_input_contract.rs`, command negative/property corpus | Planned |
| `libs/proto/elitea/runtime/v1/{control,output}.proto` | Claim, begin, authorize, lease, desired state, settlement, ordered output stream | `src/transport/control.rs`, `src/transport/output.rs` | None | Real gRPC component and failure-injection tests | Planned |
| Python worker `protocol/codec.py::{parse_and_verify_signed_command,_scan_worker_command,_validate_command}` | Verify exact signed bytes before decode; reject duplicate/unknown tags and capability mismatch | `src/protocol/envelope.rs`, `src/protocol/command.rs` | None | Fuzz/property tests and Python/Go/Rust golden commands | Planned |
| Python worker `protocol/agent.py::{parse_agent_execution_input,request_from,bind_result_artifact}` | Canonical input parsing, semantic validation, exact content binding, terminal artifact binding | `src/agents/protocol.rs`, `src/agents/result.rs` | None | Application/ad-hoc golden inputs and three supported terminal states | Planned |
| Python worker `handlers/agent.py::{AgentExecutionKind,AgentExecutionPayload,AgentExecutionHandler.execute}` | Select exactly one configured-application or ad-hoc entry point | `src/agents/request.rs` | Agent construction only after admission | Recording executor tests for both entry points | Planned |
| Python worker `execution/delivery.py::AgentExecutionDeliveryProcessor` | Claim-bound materialization, authorize-once, event/result output, settlement and ACK | `src/execution/agent_delivery.rs` | Runner invoked behind the effect fence | Component tests for recovery dispositions, ACK loss and cancellation races | Planned |
| Python worker `capabilities.py::capability_message` | Capability identity and feature advertisement | `src/capabilities.rs` | None | Manifest golden and production-registration fail-closed test | Foundation: only empty production registration exists |
| Python worker `handlers/agent_events.py::CurrentAgentNodeEventCallback` | Ordered current-compatible events, pause projection, terminal browser artifact | `src/compat/node_events.rs` | ADK events are input only | Ordered differential ordinary/HITL/MCP/tool/skill corpus | Planned |
| `libs/proto/elitea/runtime/v1/node_event.proto` and Python `protocol/node_event.py` | Exact 13-field browser event with strict JSON fragments | `src/compat/node_events.rs` | None | Cross-language JSON property/fuzz tests | Planned |

## Assembly, execution, and state

| Python source path and symbol | Observable behavior | Rust target | Native ADK primitive or Elitea ownership | Proving tests | Status / deviation |
| --- | --- | --- | --- | --- | --- |
| SDK `runtime/clients/client.py::EliteAClient.application` | Saved application/version/variables assembly and middleware policy | `src/agents/assembly.rs` | ADK agent/runner; Elitea owns admitted snapshot and policy | Application constructor and end-to-end fixture | Planned |
| SDK `runtime/clients/client.py::EliteAClient.predict_agent` | Ad-hoc model/instructions/tools/history assembly | `src/agents/assembly.rs` | ADK agent/runner; Elitea owns request policy | Ad-hoc constructor and end-to-end fixture | Planned |
| SDK `runtime/langchain/assistant.py::Assistant` | Agent, pipeline, swarm, internal-tool and lazy-tool selection | `src/agents/assembly.rs`, `src/agents/swarm.rs` | Use ADK agents/toolsets/handoffs where compatible | Mode-selection and shared-history tests | Planned |
| SDK `runtime/toolkits/tools.py::get_tools` and `runtime/lazy_tools.py::ToolRegistry` | Materialize selected tools, application tools, MCP, metadata and policies | `src/toolkits/registry.rs`, `src/agents/tools.rs` | ADK `Toolset`; Elitea owns schemas, configuration and policy | Catalog/materialization/invocation differential suites | Planned |
| SDK `runtime/langchain/langraph_agent.py::create_graph` | Compile stored pipeline YAML and current node/edge semantics | `src/agents/graph/compiler.rs`, `src/agents/graph/nodes/` | ADK graph primitives behind Elitea YAML adapter | Per-node, mapping and route fixtures | Planned |
| SDK `runtime/tools/function.py::FunctionTool.invoke` | Direct pipeline tool input/output mapping, nested state, blocked-pipeline semantics | `src/agents/graph/direct_tool.rs` | ADK tool execution; Elitea mapping and stop policy | Direct-tool, sensitive rejection and budget tests | Planned |
| Current gap: no Python graph-parallel node | Bounded true fork/join graph node, deterministic reducer/error policy, checkpointed join | `src/agents/graph/parallel.rs` | ADK graph/checkpoint primitives | Concurrency, deterministic join, branch HITL, restart, failure and cancellation tests | Intentional improvement; planned |
| SDK `runtime/tools/llm.py::LLMNode._collect_parallel_application_specs`, `_build_parallel_dispatch_specs`, `_run_parallel_application_calls` | Two or more LLM-selected Application tool calls execute concurrently | `src/agents/parallel_children.rs` | ADK bounded parallel subagent execution | Concurrency, ordering, partial error and cancellation tests | Planned; distinct from graph parallel node |
| SDK `runtime/tools/application.py::Application.invoke/_run` and `runtime/toolkits/application.py::ApplicationToolkit` | Resolve and rebuild nested application per invocation, isolate child state, map variables and ancestry | `src/agents/application_tools.rs` | ADK child agent/session; Elitea lookup, depth, variables and metadata | Cycle/depth, variable, child-HITL and identity tests | Planned |
| Centry `utils/agent_execution_common.py::{build_parked_result,build_child_launch_payloads,build_parent_reconcile_payload,apply_parallel_reconcile}` | Durable parent park, child launch, reconcile and terminal suppression | `src/agents/parallel_children.rs`, `src/compat/parallel_reconcile.rs` | ADK child checkpoints; Elitea/Main durable coordination | Cross-process crash/reconcile and multi-HITL tests | Blocked: platform currently rejects parked result end to end |
| SDK `runtime/langchain/langraph_agent.py::LangGraphAgentRunnable.invoke` | Checkpoint selection, continuation, unresolved HITL resurfacing and final result | `src/agents/session.rs`, `src/agents/result.rs` | ADK Runner/session/checkpoint | New-lineage resume/regenerate/restart tests | Planned; no LangGraph row compatibility required |
| Centry `utils/agent_execution_common.py::{setup_memory,create_memory_saver,configure_checkpoint_resume}` | Current memory backend selection and resume rules | `src/state/postgres_checkpointer.rs`, `src/compat/current_agent_request.rs` | Implement ADK Checkpointer/session traits for PostgreSQL | Real PostgreSQL setup/get/put/list/delete/concurrency/restart suite | Planned; new Rust lineage schema |
| SDK `runtime/middleware/summarization.py::SummarizationMiddleware` and Centry summary metadata | Compact only safe message boundaries and retain continuation context | `src/agents/compaction.rs` | ADK session history plus Elitea compaction policy | Tool-pair, threshold, resume and compaction-restart tests | Planned; current focused Python proof is missing |
| SDK `runtime/tools/skill_tools.py::{LoadSkillTool,loaded_skill_names_from_messages,render_skill_registry_index}` | Progressive disclosure, exact attached-name authorization, history-backed loaded state | `src/agents/skills.rs` | ADK dynamic tool binding/history | Load/dedup/compaction/reload/nested-isolation tests | Planned; current focused Python proof is missing |

## MCP, HITL, budgets, and cancellation

| Python source path and symbol | Observable behavior | Rust target | Native ADK primitive or Elitea ownership | Proving tests | Status / deviation |
| --- | --- | --- | --- | --- | --- |
| SDK `runtime/toolkits/mcp.py::McpToolkit` | Remote MCP discovery, selected tools, sessions and invocation | `src/toolkits/mcp.rs`, `src/adk/mcp.rs` | ADK MCP client/toolset | HTTP MCP discovery/invoke/timeout/cleanup tests | Planned |
| SDK `runtime/toolkits/mcp_config.py::McpConfigToolkit` | Saved MCP definitions, static/live discovery, HTTP or stdio | `src/toolkits/mcp.rs`, external MCP runner client | ADK remote MCP only | External runner isolation and contract tests | Intentional deviation: arbitrary stdio never runs in main worker |
| SDK `runtime/utils/mcp_oauth.py::McpAuthorizationRequired` and Centry MCP auth helpers | Direct preauthorization versus deferred LLM authorization; public pause shape | `src/agents/mcp_auth.rs`, `src/compat/mcp_auth.rs` | ADK interrupt; Elitea routing/aliases/tokens/UI | Authorize/skip, direct/deferred and redaction corpus | Planned |
| SDK `runtime/tools/hitl.py::HITLNode` | Pipeline HITL routes and edit/block behavior | `src/agents/hitl.rs` | ADK graph interrupt/resume | Static and real-graph resume tests | Planned |
| SDK `runtime/middleware/sensitive_tool_guard.py::SensitiveToolGuardMiddleware` | Policy matching, masking, approve/reject/edit/block, fresh invocation identity | `src/agents/sensitive_tools.rs`, `src/agents/hitl.rs` | ADK confirmation/interrupt; Elitea policy and `interrupt_id` | Identical-call-new-ID, masking, stale resume and at-most-once tests | Planned |
| SDK `runtime/exceptions.py::{BudgetExceededError,budget_exceeded_from}` | Project/member budget exhaustion is terminal and not recoverable tool content | `src/agents/budget.rs`, `src/compat/current_agent_result.rs` | ADK/Tokio cancellation; Elitea classification/message | Sibling cancellation and no-normal-success tests | Planned |
| Centry `module.py::TaskNode(kill_on_stop=True)` and Python worker lease observation | Stop/deadline and stale-fence behavior | `src/execution/cancellation.rs`, `src/transport/lease.rs` | Structured Tokio cancellation propagated into ADK | Before/during effect, deadline race, late-output fencing and shutdown tests | Intentional improvement: cooperative bounded cancellation |

## Known gates

- Centry now consumes `truncated_content`, but `AgentExecutionInputV1` has no
  corresponding field. This remains a contract-owner decision, not a Rust-only
  extension.
- `PARKED_CHILDREN` exists in the proto enum, but the committed Python/Go path
  rejects parallel reconcile inputs and the terminal state. The Rust runtime
  must not advertise this capability until Main, worker delivery and replay are
  proven together.
- Nested-skill freezing currently exists only as uncommitted work in the
  separate Go/Python thread. It is candidate evidence, not the committed Rust
  baseline.
