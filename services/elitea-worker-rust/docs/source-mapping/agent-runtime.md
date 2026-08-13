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
| `libs/proto/elitea/runtime/v1/{agent,command,envelope,input}.proto` | Reference-only signed command and bounded application/ad-hoc input | `build.rs`, `src/protocol/{mod,command,wire}.rs`, `src/agents/protocol.rs` | None | `tests/{agent_command_contract,agent_input_contract}.rs`, Python-generated fixtures and mutation/limit corpora | Partial: signed agent command plus strict agent input are implemented; full offline envelope and other capabilities are planned |
| `libs/proto/elitea/runtime/v1/{control,output}.proto` | Claim, begin, authorize, lease, desired state, settlement, ordered output stream | `src/protocol/output.rs`, `src/transport/{control,output}.rs` | None | Python progress, success and cancellation frame goldens pass; real gRPC component and failure-injection tests remain | Partial: deterministic progress/terminal framing implemented; transport, ACK/credit and settlement execution planned |
| Python worker `protocol/codec.py::{parse_and_verify_signed_command,_scan_worker_command,_validate_command,Ed25519CommandAuthenticator}` | Verify exact signed bytes before decode; reject duplicate/unknown tags and capability mismatch | `src/protocol/{command,wire}.rs` | None | `tests/agent_command_contract.rs`: Python HMAC/Ed25519 fixtures, pre-auth tamper and authenticated wire/semantic mutation corpus | Partial: both agent entrypoints are admitted; other capability commands and file-backed offline envelope remain planned |
| Python worker `protocol/agent.py::{parse_agent_execution_input,request_from,bind_result_artifact}` | Canonical input parsing, semantic validation, exact content binding, terminal artifact binding | `src/agents/protocol.rs`, `src/agents/result.rs` | None | `tests/agent_input_contract.rs`: Python application/ad-hoc fixtures, duplicate/depth/string/number/truncation corpus and three supported terminal states | Partial: implemented through typed request and terminal artifact; delivery invocation remains gated |
| Python worker `handlers/agent.py::{AgentExecutionKind,AgentExecutionPayload,AgentExecutionHandler.execute}` | Select exactly one configured-application or ad-hoc entry point | `src/agents/request.rs` | Agent construction only after admission | Typed fixture tests for both entry points; recording executor test remains planned | Foundation: immutable kind/payload/request exist; runtime delegation is not implemented |
| Python worker `protocol/codec.py::build_node_event_output_frame` and Main `domain/runtime/fence.go::Fence.Validate` | Bind validated event to verified command identity, post-claim nonzero fence, sequence, digest and 64 KiB frame | `src/protocol/output.rs` | None | `tests/node_event_contract.rs::exact_python_vectors_match_browser_proto_and_claim_bound_output_frame` and identity/fence mutations | Implemented for nonterminal agent progress; Rust rejects an all-zero fence token before Main, closing a legacy Python-helper gap |
| Python worker `protocol/codec.py::{build_output_frame,_runtime_error_message}` and Main `application/output/agent_execution.go` | Bind agent result or registered failure to terminal identity, exact payload digest and deterministic settlement proposal | `src/protocol/output.rs`, strengthened result checks in `src/agents/result.rs` | None | `tests/agent_output_contract.rs`: exact Python success/cancellation frames, all nine safe error mappings, digest/settlement and malformed-result corpus | Implemented terminal frame construction. Rust rejects zero digests and artifacts over 64 KiB before Main; terminal ACK, PrepareSettlement and Redis ACK ordering are not part of this slice |
| Python worker `execution/delivery.py::AgentExecutionDeliveryProcessor` | Claim-bound materialization, authorize-once, event/result output, settlement and ACK | `src/execution/agent_delivery.rs` | Runner invoked behind the effect fence | Component tests for recovery dispositions, ACK loss and cancellation races | Planned |
| Python worker `capabilities.py::capability_message` | Capability identity and feature advertisement | `src/capabilities.rs` | None | Manifest golden and production-registration fail-closed test | Foundation: only empty production registration exists |
| Python worker `handlers/agent_events.py::CurrentAgentNodeEventCallback` | Ordered current-compatible events, pause projection, terminal browser artifact | `src/agents/events.rs` | ADK events are input only | Ordered differential ordinary/HITL/MCP/tool/skill corpus | Planned; not conflated with the generic codec |
| `libs/proto/elitea/runtime/v1/node_event.proto`, Python `protocol/node_event.py`, and Main `runtimegrpc/nodeevent/codec.go` | Exact 13-field browser event, arbitrary JSON fragments, defaults, bounds and Go escaping | `src/protocol/node_event.rs`, closed rules in `src/protocol/wire.rs` | None | `tests/node_event_contract.rs`, existing two-case/36-type corpus, Python exact vectors and malformed/mutation cases | Implemented generic codec; unknown protobuf tags and noncanonical replay bytes intentionally fail earlier in Rust. Rust retains compact raw fragment number/escape spellings like authoritative Go `json.Compact`; Python currently normalizes those spellings while preserving semantics |

### Intentional NodeEvent codec deviations

The committed Python and Go codecs disagree on noncanonical-but-valid JSON
fragment spellings. Python parses then serializes, so `"\u0061"`, `1e0` and
`-0` become `"a"`, `1.0` and `0`. Main's Go codec uses `json.Compact` and
preserves the original spellings. Rust deliberately follows the Go durable
consumer: it validates and compacts fragments without float coercion or string
normalization. Browser semantics are unchanged, but semantically equal input
from Python and Rust can have different protobuf bytes and payload digests.
`tests/fixtures/node_event_vectors.txt` and
`go_authoritative_raw_fragment_policy_is_explicit_against_python_normalization`
freeze this disagreement explicitly; the future event bridge must construct
stable fragments once and rely on spool replay rather than regenerate an
already allocated sequence.

Rust also classifies byte, depth, decoded-string, protobuf and complete-frame
limit failures as `ProtocolError::ResourceExhausted`. The current Python codec
collapses most of these into `InvalidCurrentNodeEvent`, which its delivery
bridge maps to `INVALID_INPUT`. The typed Rust classification is intentional;
the future UI compatibility bridge may map it to the legacy public error only
where the existing product contract requires that presentation. Neither
deviation is a claim of byte-for-byte Python parity.

The agent result's nested artifact message is only an immutable reference. Its
digest is distinct from the output frame payload digest, and current Main does
not perform the index-ingest path's durable artifact verification for agent
results. Terminal frame construction therefore does not claim that artifact
bytes are durable. Production registration stays disabled until Main owns that
verification/commit boundary or an equivalent contract is introduced and
tested end to end.

### Agent input field projection

Every wire field is declared in `libs/proto/elitea/runtime/v1/agent.proto`,
decoded by Python `protocol/agent.py::request_from`, and now owned by the Rust
types below. This is a field projection, not dispatch authority: fences and
runtime clients never become request fields. `mcp_tokens` is claim-fetched
secret data, so the Rust payload intentionally implements neither `Clone` nor
`Debug`.

| Proto fields | Python projected payload | Rust projection and validator | Status |
| --- | --- | --- | --- |
| `schema_revision` | validated before `request_from` | `protocol.rs::parse_agent_execution_input` | Implemented |
| `llm`, `chat_history`, `user_input` | `AgentExecutionPayload.{llm,chat_history,user_input}` | `request.rs::AgentExecutionPayload`; object/list/text-or-block validation in `protocol.rs` | Implemented |
| `thread_id`, `checkpoint_id`, `debug` | same names | `request.rs::AgentExecutionPayload` with protobuf presence preserved | Implemented |
| `tools`, `application`, `internal_tools`, `steps_limit` | same names | owned JSON/list/string-list/positive `u32`; application/ad-hoc identity checks in `protocol.rs` | Implemented |
| `mcp_tokens`, `ignored_mcp_servers`, `user_declined_mcp_servers` | same names | owned object/list fields in `request.rs`; credential redemption remains outside this type | Implemented wire parity; runtime auth planned |
| `should_continue`, `hitl_resume`, `hitl_action`, `hitl_value`, `hitl_decisions` | same names | presence-preserving fields plus resume-decision invariant in `protocol.rs` | Implemented input parity; continuation runtime planned |
| `execution_generation`, `is_regenerate`, `meta`, `conversation_id` | same names | owned immutable fields in `request.rs` | Implemented input parity |
| `persona`, `context_settings`, `supports_vision`, `return_chat_history` | same names; empty persona becomes `generic` | same fields and default in `request.rs`/`protocol.rs` | Implemented input parity |
| `invoked_skills`, `applied_skills`, `attached_skills` | same names | owned JSON lists in `request.rs` | Implemented input parity; skill runtime planned |
| `auto_approve_sensitive_actions`, `input_attachments` | same names | owned fields in `request.rs` | Implemented input parity; policy/effect runtime planned |
| `parallel_reconcile`, `parallel_terminal_errors` | same names | optional object/list in `request.rs` | Implemented decoding only; end-to-end behavior blocked |
| `exception_handling_enabled`, `debug_mode` | same names | `Option<bool>` in `request.rs` | Implemented |
| `next_input_suggestion` | bounded policy object with defaults | typed `NextInputSuggestionPolicy` and closed-field validation | Implemented |

## Assembly, execution, and state

| Python source path and symbol | Observable behavior | Rust target | Native ADK primitive or Elitea ownership | Proving tests | Status / deviation |
| --- | --- | --- | --- | --- | --- |
| SDK `runtime/clients/client.py::EliteAClient.application` | Saved application/version/variables assembly and middleware policy | `src/agents/assembly.rs` | ADK agent/runner; Elitea owns admitted snapshot and policy | Application constructor and end-to-end fixture | Planned |
| SDK `runtime/clients/client.py::EliteAClient.predict_agent` | Ad-hoc model/instructions/tools/history assembly | `src/agents/assembly.rs` | ADK agent/runner; Elitea owns request policy | Ad-hoc constructor and end-to-end fixture | Planned |
| SDK `runtime/langchain/assistant.py::Assistant` | Agent, pipeline, swarm, internal-tool and lazy-tool selection | `src/agents/assembly.rs`, `src/agents/swarm.rs` | Use ADK agents/toolsets/handoffs where compatible | Mode-selection and shared-history tests | Planned |
| SDK `runtime/toolkits/tools.py::get_tools` and `runtime/lazy_tools.py::ToolRegistry` | Materialize selected tools, application tools, MCP, metadata and policies | `src/toolkits/registry.rs`, `src/agents/tools.rs` | ADK `Toolset`; Elitea owns schemas, configuration and policy | Catalog/materialization/invocation differential suites | Planned |
| SDK `runtime/langchain/langraph_agent.py::create_graph` | Compile stored pipeline YAML and current node/edge semantics | `src/agents/graph/compiler.rs`, `src/agents/graph/nodes/` | ADK graph primitives behind Elitea YAML adapter | Per-node, mapping and route fixtures | Planned |
| SDK `runtime/tools/function.py::FunctionTool.invoke` | Direct pipeline tool input/output mapping, nested state, blocked-pipeline semantics | `src/agents/graph/direct_tool.rs` | ADK tool execution; Elitea mapping and stop policy | Direct-tool, sensitive rejection and budget tests | Planned |
| Current gap: no Python graph-parallel node | Bounded true fork/join graph node, deterministic reducer/error policy, checkpointed join | `src/agents/graph/parallel.rs` | ADK `StateGraph` fan-out, deferred fan-in and `CompiledGraph::with_max_concurrency` | Concurrency, deterministic join, branch HITL, restart, failure and cancellation tests | Intentional improvement; planned |
| SDK `runtime/tools/llm.py::LLMNode._collect_parallel_application_specs`, `_build_parallel_dispatch_specs`, `_run_parallel_application_calls` | Two or more LLM-selected Application tool calls execute concurrently | `src/agents/parallel_children.rs` | ADK child agents inside an Elitea-owned bounded task group; `ParallelAgent` alone is not a capacity policy | Concurrency, ordering, partial error and cancellation tests | Planned; distinct from graph parallel node |
| SDK `runtime/tools/application.py::Application.invoke/_run` and `runtime/toolkits/application.py::ApplicationToolkit` | Resolve and rebuild nested application per invocation, isolate child state, map variables and ancestry | `src/agents/application_tools.rs` | ADK child agent/session; Elitea lookup, depth, variables and metadata | Cycle/depth, variable, child-HITL and identity tests | Planned |
| Centry `utils/agent_execution_common.py::{build_parked_result,build_child_launch_payloads,build_parent_reconcile_payload,apply_parallel_reconcile}` | Durable parent park, child launch, reconcile and terminal suppression | `src/agents/parallel_children.rs`, `src/compat/parallel_reconcile.rs` | ADK child checkpoints; Elitea/Main durable coordination | Cross-process crash/reconcile and multi-HITL tests | Blocked: platform currently rejects parked result end to end |
| SDK `runtime/langchain/langraph_agent.py::LangGraphAgentRunnable.invoke` | Checkpoint selection, continuation, unresolved HITL resurfacing and final result | `src/agents/session.rs`, `src/agents/result.rs` | ADK Runner/session/checkpoint | New-lineage resume/regenerate/restart tests | Planned; no LangGraph row compatibility required |
| Centry `utils/agent_execution_common.py::{setup_memory,create_memory_saver,configure_checkpoint_resume}` | Current memory backend selection and resume rules | `src/state/postgres_checkpointer.rs`, `src/compat/current_agent_request.rs` | Implement ADK `Checkpointer` for PostgreSQL; keep tenant/thread authorization, generation fencing and writer control outside the trait | Real PostgreSQL full-field/prune/delete/wrong-thread/tenant/concurrency/restart suite | Planned; new Rust lineage schema |
| SDK `runtime/middleware/summarization.py::SummarizationMiddleware` and Centry summary metadata | Compact only safe message boundaries and retain continuation context | `src/agents/compaction.rs` | ADK session history plus Elitea compaction policy | Tool-pair, threshold, resume and compaction-restart tests | Planned; current focused Python proof is missing |
| SDK `runtime/tools/skill_tools.py::{LoadSkillTool,loaded_skill_names_from_messages,render_skill_registry_index}` | Progressive disclosure, exact attached-name authorization, history-backed loaded state | `src/agents/skills.rs` | ADK dynamic tool binding/history | Load/dedup/compaction/reload/nested-isolation tests | Planned; current focused Python proof is missing |

## MCP, HITL, budgets, and cancellation

| Python source path and symbol | Observable behavior | Rust target | Native ADK primitive or Elitea ownership | Proving tests | Status / deviation |
| --- | --- | --- | --- | --- | --- |
| SDK `runtime/toolkits/mcp.py::McpToolkit` | Remote MCP discovery, selected tools, sessions and invocation | `src/toolkits/mcp.rs`, `src/adk/mcp.rs` | ADK MCP client/toolset | HTTP MCP discovery/invoke/timeout/cleanup tests | Planned |
| SDK `runtime/toolkits/mcp_config.py::McpConfigToolkit` | Saved MCP definitions, static/live discovery, HTTP or stdio | `src/toolkits/mcp.rs`, external MCP runner client | ADK remote MCP only | External runner isolation and contract tests | Intentional deviation: arbitrary stdio never runs in main worker |
| SDK `runtime/utils/mcp_oauth.py::McpAuthorizationRequired` and Centry MCP auth helpers | Direct preauthorization versus deferred LLM authorization; public pause shape | `src/agents/mcp_auth.rs`, `src/compat/mcp_auth.rs` | ADK interrupt; Elitea routing/aliases/tokens/UI | Authorize/skip, direct/deferred and redaction corpus | Planned |
| SDK `runtime/tools/hitl.py::HITLNode` | Pipeline HITL routes and edit/block behavior | `src/agents/hitl.rs` | ADK graph interrupt/resume | Static and real-graph resume tests | Planned |
| SDK `runtime/middleware/sensitive_tool_guard.py::SensitiveToolGuardMiddleware` | Policy matching, masking, approve/reject/edit/block, fresh invocation identity | `src/agents/sensitive_tools.rs`, `src/agents/hitl.rs` | ADK graph checkpoints/interrupts for durable resume; ordinary LLM confirmation is insufficient by itself | Identical-call-new-ID, masking, stale resume and at-most-once tests | Planned |
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
