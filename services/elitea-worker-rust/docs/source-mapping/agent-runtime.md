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
| `libs/proto/elitea/runtime/v1/{control,output}.proto` | Claim, begin, authorize, lease, desired state, settlement, ordered output stream | `src/protocol/{control,output}.rs`, `src/transport/{control_grpc,output_session,output_grpc}.rs` | None | Python progress/success/cancellation/control goldens; claim/manifest/recovery mutation, control sum-type, lease, message-boundary and ACK/credit/replay state corpora | Partial: the complete claim/recovery disposition sum type, begin/authorize decisions, non-clone invocation permit, lease/desired-state semantics, fresh and recovered settlement receipt validation, and one-attempt control/output transports are implemented; Redis retirement ordering and shared delivery coordination remain planned |
| Python worker `protocol/codec.py::{parse_and_verify_signed_command,_scan_worker_command,_validate_command,Ed25519CommandAuthenticator}` | Verify exact signed bytes before decode; reject duplicate/unknown tags and capability mismatch | `src/protocol/{command,wire}.rs` | None | `tests/agent_command_contract.rs`: Python HMAC/Ed25519 fixtures, pre-auth tamper and authenticated wire/semantic mutation corpus | Partial: both agent entrypoints are admitted; other capability commands and file-backed offline envelope remain planned |
| Python worker `protocol/agent.py::{parse_agent_execution_input,request_from,bind_result_artifact}` | Canonical input parsing, semantic validation, exact content binding, terminal artifact binding | `src/agents/protocol.rs`, `src/agents/result.rs` | None | `tests/agent_input_contract.rs`: Python application/ad-hoc fixtures, duplicate/depth/string/number/truncation corpus and three supported terminal states | Partial: implemented through typed request and terminal artifact; delivery invocation remains gated |
| Python worker `handlers/agent.py::{AgentExecutionKind,AgentExecutionPayload,AgentExecutionHandler.execute}` | Select exactly one configured-application or ad-hoc entry point | `src/agents/request.rs` | Agent construction only after admission | Typed fixture tests for both entry points; recording executor test remains planned | Foundation: immutable kind/payload/request exist; runtime delegation is not implemented |
| Python worker `protocol/codec.py::build_node_event_output_frame` and Main `domain/runtime/fence.go::Fence.Validate` | Bind validated event to verified command identity, post-claim nonzero fence, sequence, digest and 64 KiB frame | `src/protocol/output.rs` | None | `tests/node_event_contract.rs::exact_python_vectors_match_browser_proto_and_claim_bound_output_frame` and identity/fence mutations | Implemented for nonterminal agent progress; Rust rejects an all-zero fence token before Main, closing a legacy Python-helper gap |
| Python worker `protocol/codec.py::{build_output_frame,_runtime_error_message}` and Main `application/output/agent_execution.go` | Bind agent result or registered failure to terminal identity, exact payload digest and deterministic settlement proposal | `src/protocol/output.rs`, strengthened result checks in `src/agents/result.rs` | None | `tests/agent_output_contract.rs`: exact Python success/cancellation frames, all nine safe error mappings, digest/settlement and malformed-result corpus | Implemented terminal frame construction, terminal ACK proof and typed PrepareSettlement request/receipt. Rust rejects zero digests and artifacts over 64 KiB before Main; Redis ACK ordering remains planned |
| Python worker `transport/output_spool.py::EncryptedOutputSpool` | Bounded AES-256-GCM file format, idempotent immutable put, sorted replay, exact atomic replacement and ACK deletion | `src/spool.rs::{EncryptedOutputSpool,SpooledFrame,SpoolLimits}` | None | `tests/output_spool_contract.rs`: encryption, capacity, replacement, replay, corruption, unsafe entries, permissions, ownership and cleanup; Python fixed-nonce golden | Implemented synchronous primitive for macOS/Linux. Rust uses directory-relative filesystem calls, validates owner-private files and holds an exclusive advisory child lock |
| Python worker `serve.py::{_execution_spool_binding,_prepare_execution_spool}` | Seven-field length-prefixed identity, SHA-256 child path, HKDF-SHA256 execution key and stream AAD | `src/spool.rs::{ExecutionSpoolIdentity,ExecutionSpoolBinding,SpoolMasterKey}` | None | `src/spool.rs::tests::binding_hkdf_and_fixed_nonce_ciphertext_match_python` generated by `tests/fixtures/generate_output_spool_fixtures.py` | Implemented without caller-supplied derived key/path/AAD, preventing identity drift |
| Python worker `transport/output_grpc.py::OutputGrpcSession::{start,send,_restore_pending,_replay_pending}` | Validate one bootstrap grant, restore exact deterministic frames, block new admission behind replay, persist before send and await one bound ACK per replayed frame | `src/transport/output_grpc.rs::OutputGrpcSession`, `src/transport/output_session.rs::{OutputSessionState,DurableOutputFrame}` | None | Unit state corpus plus encrypted-spool component cases `lost_ack_preserves_exact_spool_for_next_session_replay` and `early_eof_during_replay_preserves_the_durable_frame` | Implemented for one attempt. Delivery-owned bounded fresh-session reconnect is planned rather than hidden inside the stream |
| Python worker `transport/output_grpc.py::OutputGrpcSession::_accept_ack` and Main `runtimegrpc/output/server.go::Server.Publish` | Absolute credit replacement, exact stream/identity/fence/watermark binding, monotonic committed prefix and typed cancellation/deadline/retry results | `src/transport/output_session.rs::{validate_ack,commit_ack}` | None | Bootstrap-once, credit ceiling, forged fence, backward/beyond-write ACK, draining and winner mutation tests | Implemented. Rust additionally bounds durable counters to PostgreSQL `BIGINT`; protobuf ACK duplicate/unknown-field inspection is limited by tonic/prost and recorded below |
| Python worker `transport/output_grpc.py::OutputGrpcSession::{replays,replace_pending_exact,replace_pending_cancelled_recovery,replace_pending_ambiguous_recovery}` and `execution/delivery.py::_reconnectable_output` recovery decisions | Inspect durable bytes before networking; exact-CAS the sole pending frame; allow only advancing fresh-fence cancellation/ambiguous recovery; retire only a completely covered prefix | `src/transport/output_grpc.rs::PreparedOutputSpool` | None | No-network prepare/reopen, post-terminal rejection, complete-prefix reconciliation, exact terminal CAS and cancelled/ambiguous rebind mutation tests | Implemented as an explicit pre-network typestate boundary. A reconciled object cannot be reused, and stream connection consumes the prepared spool |
| Python worker `transport/output_grpc.py::secure_output_channel`, `_validated_metadata` | mTLS output endpoint, 64 KiB request/80 KiB response limits and allowlisted session metadata | `src/transport/output_grpc.rs::TonicOutputStream` plus planned deployment TLS composition | None | Configuration/message-limit/metadata unit tests; real mTLS component test planned | Partial: tonic sets exact encoding/decoding ceilings and sends each metadata key once over an injected channel. CA/certificate/key loading and hostname policy are not yet implemented |
| Python worker `transport/control_grpc.py::{ExecutionControlClient,_validated_metadata}` | One deadline-bound RPC attempt, 64 KiB request/80 KiB response bounds and exact workload metadata | `src/transport/control_grpc.rs::{ControlGrpcClient,TonicControlRpc}` | None | Injected component transport covers all six methods, exact request/response limits, metadata/deadline mutations and data-free one-attempt failure | Implemented transport only. Rust requires ASCII because these are non-binary gRPC metadata values; production Python also supplies ASCII deployment identities. Semantic response validation is owned by `src/protocol/control.rs`; TLS file/hostname policy remains a deployment gate |
| Python worker `execution/delivery.py::{_claim_receipt,_accepted_agent_claim,_validated_claim_entries,_validate_receipt_identity,_validate_active_fence}` and Main `runtimegrpc/control/server.go::{ClaimCommand,verifyResolvedManifest}` | Seal one fresh, exact command/fence/manifest authority only after authenticated claim | `src/protocol/control.rs::{AgentControlClient::claim_agent,AcceptedAgentClaim}` | None | `tests/agent_control_contract.rs`: deterministic Python vector plus identity/fence/digest/role/count/expiry mutation matrix | Implemented for fresh `ACCEPTED` agent claims. Raw response parsers are private, and no recovery disposition can be coerced into `AcceptedAgentClaim` |
| Python worker `execution/delivery.py::{_validate_obsolete_receipt,_validate_retired_receipt,_validate_recover_running_receipt,_terminal_ack_recovery,_prepared_settlement_recovery}` and Main `claims.go::ClaimDecision.validate` | Interpret all ten claim dispositions without leaking inputs into recovery, distinguish ACK/no-ACK authority, and never re-enter the SDK after ambiguous invocation | `src/protocol/control.rs::{AgentControlClient::claim_agent_delivery,AgentClaimDecision,AgentOutputRecovery,RecoverTerminalAck,RecoveredSettlement,TerminalCommandAck}` | None | Python-generated vector for every disposition; input/authority leakage, retirement, proposal digest and exact settlement replay mutation cases | Implemented closed recovery admission. Only `Accepted` contains business input; active/running/ambiguous states expose output recovery plus a unique lease handle, while terminal proposal/receipt types permit only settlement replay or Redis retirement. `SETTLED_ACK` remains consumer-supported but no current Main repository producer branch was found |
| Python worker `execution/delivery.py::{_begin_execution,_authorize_invocation}` and Main durable claim state | Distinguish restart-safe preparation from the one durable SDK submission fence | `src/protocol/control.rs::{BeginAgentExecution,LeaseMonitoredAgentExecution,InvocationAuthorizationDecision,InvocationPermit}` | ADK entry will consume the opaque permit later | Exact Python decision vectors, mixed response and owned typestate transitions | Implemented semantic boundary. `STARTED_NOW` is not treated as an invocation token; an owned authenticated operation consumes preparation, and only `AUTHORIZED_NOW` mints one private-field, non-`Clone` permit |
| Python worker `execution/delivery.py::_ClaimLeaseMonitor` | Exact-fence deterministic renewal keys, nonregressing expiry, two-poll margin and closed desired states | `src/protocol/control.rs::{ClaimLeaseHandle,AgentControlClient::renew_lease,AgentControlClient::observe_lease}` | None | Python key/response vectors; margin/cancellation priority and mixed response tests | Implemented unique lease authority and pure response semantics. The handle owns its monotonic renewal sequence and immutable fence. Main does not currently deduplicate by renewal key, so Rust does not claim key-based replay safety; the async polling task remains planned |
| Python worker `execution/delivery.py::{_prepare_frame_settlement,_settlement_receipt,_terminal_ack_recovery,_prepared_settlement_recovery}` | Only a bound durable terminal ACK or exact state-owner recovery proposal can create PrepareSettlement; an already-prepared receipt skips the RPC | `src/transport/output_grpc.rs::{OutputGrpcSession::send_terminal,DurablyAckedTerminal}`, `src/protocol/control.rs::{AgentControlClient::{prepare_agent_settlement,prepare_recovered_agent_settlement},RecoverTerminalAck,RecoveredSettlement,SettlementReceipt}` | None | Bound ACK to consumed settlement proof component test; Python fresh/recovery vectors, deterministic digest and no-second-RPC assertions | Implemented fresh and restart settlement authority. Raw success/recovery protobufs cannot construct proofs, and the recovered proposal is replayed byte-for-byte before a validated outcome-bound receipt is returned |
| Python worker `execution/delivery.py::_publish_output`, `_reconnectable_output` | Bounded new-session retry over the unchanged encrypted spool | planned `src/execution/output_delivery.rs` | None | ACK-loss retry-budget and cross-process restart tests | Planned; a failed Rust session is latched unusable and leaves its spool files intact for a freshly opened handle |
| Python worker `execution/delivery.py::_prepare_frame_settlement` and `control_grpc.py::ExecutionControlClient.prepare_settlement` | Terminal bound ACK and spool retirement precede deterministic PrepareSettlement; Redis retirement follows the validated receipt | `src/transport/output_grpc.rs`, `src/protocol/control.rs`, planned `src/execution/agent_delivery.rs` | None | Bound-ACK/proposal-digest/receipt component test; recovery and Redis-order system tests planned | Partial: output ACK creates a consuming proof and semantic control prepares the exact settlement. Redis retirement and recovery disposition ordering remain delivery-owned gates |
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

The authoritative Go admission contract and the Python worker constant both
set the agent-execution input limit to 1 MiB, and Rust follows that limit in
`src/protocol/control.rs`. The current Python content HTTP configuration and
shared fixture projector still cap all materialized bodies at 256 KiB. This is
a recorded source drift, not simultaneous parity: production enablement must
either raise the Python-era data-plane limit to the admitted 1 MiB or tighten
the language-neutral contract consistently. Rust does not silently inherit the
shared settings limit for agent protobuf input.

Rust also rejects rejection responses that simultaneously carry success
disposition, lease/state or settlement receipt fields. Python already enforces
this for Begin/Authorize but not every control response; Main emits exclusive
shapes today. The stricter sum-type interpretation is deliberate protocol
hardening and is covered by mutation tests.

### Output spool deployment and rotation gates

The compatible disk format is `ELITEASPOOL1\0`, a 12-byte random nonce and
AES-256-GCM ciphertext/tag. The entry AAD binds the seven-field execution
identity and big-endian sequence. Rust preserves that format so a drained
Python replica can be restarted by Rust with the same root and master key.

One persistent spool root belongs to exactly one worker replica, and one
execution child has exactly one live process owner. Rust holds a nonblocking
advisory directory lock as defense in depth, but the Python worker does not
participate in it and network/FUSE lock semantics are not a correctness
boundary. Mixed-language rollout therefore uses distinct replica roots or a
strictly exclusive lifecycle on local/block-backed persistent storage.

The v1 file has no key identifier. Rotating the 32-byte master key while any
encrypted entry remains would make recovery impossible. Production wiring must
either drain every replica root before rotation or introduce and test a
versioned keyring/file revision. This primitive deliberately implements
neither silent fallback nor multi-key trial decryption.

`SpoolMasterKey` and the explicit 32-byte HKDF expansion buffer are zeroized
when their Rust owners release them. `ring` 0.17.14 does not document
zeroize-on-drop for its internal HKDF PRK or installed AES key schedule, so
this slice does not claim complete post-drop key erasure from worker process
memory. Process isolation and termination remain the memory-disposal boundary;
a future stronger in-process erasure requirement must select and audit a
cipher/KDF representation which guarantees it.

### Output stream boundaries and deviations

`src/transport/output_grpc.rs` owns one ordered stream attempt. It receives and
validates bootstrap credit before any write, uses tonic's bounded request
channel, persists exact deterministic protobuf bytes on the blocking pool,
consumes absolute frame/byte credit, waits for the bound ACK, deletes and
fsyncs the acknowledged spool prefix, and only then advances the caller-visible
watermark. Transport failure latches the attempt unusable; the delivery layer
will create a fresh stream and a fresh exclusive spool handle for bounded
replay, matching Python's retry ownership rather than reconnecting secretly.

`PreparedOutputSpool` validates and exposes the encrypted durable state before
any endpoint is contacted. Delivery coordination must choose exact replay,
complete-prefix reconciliation, same-binding terminal replacement, or one of
the two narrowly validated fresh-fence recovery replacements before consuming
the object to connect. Appending after a terminal and reusing a reconciled
object are rejected by the Rust state machine.

An owned per-execution actor continues an admitted durable send even when its
caller stops awaiting it, preventing delayed ACK reassignment. Its admission
channel and byte permit allow only one current frame; explicit close interrupts
credit, send, or ACK waits and joins the actor before releasing the spool lock.

Production Main grants one frame and 64 KiB. Rust therefore serializes each
execution's `spool -> send -> ACK` operation. Tonic/hyper independently drives
HTTP/2 request and response I/O, so the first send enters an empty bounded
channel and ACK receipt is not coupled to a blocking socket write. This is an
intentional simplification of Python's separate writer/receiver task pair for
the current one-frame window; any future server policy with multiple in-flight
frames requires a new bounded-concurrency proof rather than silently changing
this state machine.

Although protobuf counters are unsigned, Main stores sequence, generation,
claim attempt, lease epoch and handoff watermark in PostgreSQL `BIGINT`. Rust
rejects values above `i64::MAX` before transport. This narrows the Python
session's nominal `u64` acceptance to the actual durable consumer domain.

The output channel is injected, not constructed from TLS files in this slice.
The generated tonic client is explicitly capped at 64 KiB encoded requests and
80 KiB decoded ACKs, and sends the two allowlisted workload metadata values
once. Production composition must still load private material safely, require
TLS 1.3 and verified client/server identities, and prove hostname/CA failure
cases. Passing a channel is not production admission authority.

Tonic's generated prost response decoder does not expose erased unknown or
duplicate ACK fields for a second strict-wire scan. Current Main is mutually
authenticated and emits canonical ACKs, so exact decoded binding and semantic
validation is the current compatibility boundary. Symmetric raw-wire rejection
would require a reviewed custom tonic codec and remains a production-hardening
decision, not a claimed property of this slice.

The control transport follows the same composition boundary. It clones tonic's
cheap HTTP/2 client handle per call so lease polling and delivery fencing do not
share a mutable request bottleneck, applies a positive deployment deadline of
at most five minutes, and performs exactly one attempt. It never interprets a
claim, begin, invocation, lease, desired-state, or settlement response as
authority; the typed semantic validator and delivery state machine own those
decisions. The current semantic client consumes authenticated one-attempt RPC
results behind non-forgeable claim, lease, invocation and terminal-settlement
typestates; callers cannot mint those proofs from decoded protobuf values.

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

- `TerminalCommandAck` and `RecoveredSettlement` are not yet connected to a
  Redis retirement adapter. That adapter must consume the opaque proof inside
  the same verified delivery binding and compare the command/outbox identity;
  accepting a proof plus an unrelated caller-selected delivery would permit
  accidental cross-delivery token substitution.
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
