# ADK-Rust 2.0.0 adoption ledger

This ledger records what the Rust worker adopts from the exact published
ADK-Rust `2.0.0` sources, what Elitea wraps, and what remains deferred. It keeps
framework evaluation separate from capability claims: a promising crate or
passing upstream test does not register a production worker capability.

## Decision rules

- Prefer a native ADK primitive when it preserves Elitea's admitted behavior,
  authority boundary, durability and resource limits.
- Wrap a primitive when Elitea must add tenant scope, workload identity,
  credential redemption, effect fencing, backpressure or `NodeEventV1` output.
- Reject a direct integration when it would create a second lifecycle authority
  beside Main, bypass egress policy, expose raw credentials, or claim durability
  the primitive does not provide.
- Enable optional Cargo features one reviewed slice at a time. Do not enable the
  `minimal`, `standard`, `enterprise`, `full` or `action-full` presets.

## Capability decisions

| Area | ADK-Rust 2.0.0 evidence | Decision | Elitea owner / next proof |
| --- | --- | --- | --- |
| Agent and runner | `LlmAgent`, `Runner`, `RunnerConfig`, `Event` | Adopt behind the sealed one-shot invocation state | Main claim/authorize fence, supervised lifetime, progress/terminal output and Redis retirement remain Elitea-owned |
| Event stream | `EventStream`, `Event`, `Content`, `Part` | Adopt as internal semantic input, not as the browser/output contract | The closed ordinary-text projector maps bounded root-model text/thinking events to current `NodeEventV1` shapes and drains through EOS. Elitea's capability-disabled fresh publisher now keeps the exact command-bound cursor, encrypted spool, live or restored session, one pending frame and the 1..8 attempt budget inseparable. It reuses an ACKed live stream, persists before uncertain delivery, reopens only byte-identical progress, retries a cancelled restored wait on the same owned replay, and closes/inspects a cancelled live send before any resend. Only an opaque exact-frame ACK advances sequence; an exact Main cancellation/deadline rejection remains separate same-sequence replacement authority. Full-message artifact binding, terminal-after-progress publication, sanitization, durable ADK composition and tool/HITL/MCP/application completion projection remain Elitea-owned gates |
| Graph/tool custom progress | Functional `TaskContext::emit(StreamEvent::custom(...))`, graph `NodeOutput.events`, and `ToolContext::emit_progress` | Wrap; never treat raw JSON or broadcast delivery as authoritative output | Useful for allowlisted pipeline and later indexing semantic events. Functional `emit` uses a Tokio broadcast sender and silently has no effect without listeners, so durable indexing/progress must still pass through the Elitea spool/send/ACK coordinator with schema, size and redaction policy. Tool progress already enters the ADK event stream but remains gated until its call identity and current browser shape are mapped |
| Models | Provider-neutral `Llm`; optional OpenAI/Anthropic and other feature gates | Wrap | Construct the provider only after the authorized claim redeems credentials. Initial Elitea gateway support uses reviewed OpenAI-compatible routing; native Anthropic requires a header/routing compatibility adapter rather than silent coercion |
| Tools/toolsets | `Tool`, `Toolset`, `BasicToolset`, typed tool macro | Adopt and wrap | Elitea owns saved configuration, selected-tool identity, grants, sensitive policy, absolute deadline, bounded concurrency and result projection |
| Sessions | `SessionService` and Runner session integration | Adopt interface, replace persistence where required | Prove deterministic ordering, SQL-bounded history, metadata fidelity, concurrent deltas and compaction reconstruction |
| Checkpoints | `Checkpointer`; bundled SQLite implementation | Adopt exact trait with Elitea PostgreSQL backend | Implemented fresh native canonical-JSON-text lineage with current-claim fencing and shared pooling; invocation composition and cutover remain |
| Graph | `StateGraph`, custom `Node`, deferred nodes, bounded compiled concurrency | Adopt compiler substrate | Elitea YAML compiler owns compatibility, reducers, policy and durable fan-in extension |
| Fixed subagents | `SequentialAgent`, `LoopAgent`, `ParallelAgent` | Adopt where semantics match | Add an outer admission/cancellation policy. `ParallelAgent` is distinct from the new graph `parallel` node |
| MCP | HTTP clients, toolset and server manager behind optional feature | Wrap | Saved MCP admission, workload credentials, OAuth/HITL, bounded connections, name isolation, replay policy and external stdio runner remain Elitea-owned |
| Sensitive tools/HITL | Function-call confirmation plus graph interrupts/checkpoints | Compose | Bind decisions to the current interrupt/function-call identity. Identical name and arguments can be a new call; tool arguments alone never authorize it |
| Action HTTP | Graph action creates a fresh unrestricted `reqwest::Client`, interpolates URL/auth and includes dependency text in errors | Do not enable directly | A future Elitea HTTP capability must enforce approved origins, DNS/IP/redirect policy, workload credential references, response/body bounds, deadlines and redacted errors; the ADK config/action shape may be reused behind it |
| Action database | ADK 2.0.0 validates config but its SQL/Mongo/Redis executors are explicit placeholders | Reject as executable capability | Design typed, allowlisted database operations with dedicated pools and workload grants only if a real product use case is approved |
| Action code / code tools | Optional action/code/sandbox feature families exist | Separate plan | Current code-node parity requires a reviewed isolation boundary, filesystem/network policy, resource metering and artifact contract; it is not enabled inside the main worker process by this replatform slice |
| Managed runtime | Optional `managed-runtime` exposes another lifecycle abstraction | Defer | Main plus the worker delivery coordinator remain the only execution authority. Revisit only as an internal adapter after proving it cannot duplicate claims, settlement or recovery |
| Semantic memory | Optional memory service and database/Redis/SQLite backends | Defer and wrap | Define tenant/project/agent namespace, consent, retention, deletion, embedding/provider and poisoning policy before enabling global agent or graph memory |
| Realtime/voice | Optional realtime runner and transport/provider features | Defer and wrap | Map current voice/ASR/TTS session behavior, cancellation, quotas and `NodeEventV1`/media boundaries first; do not enable the enterprise preset |
| Redis | ADK offers optional execution-state backends | Do not substitute | The restricted redis-rs transport now owns Elitea command intake, PEL reclaim/heartbeat and exact post-settlement retirement. The worker serve loop/reconnect system test remains. A later memory/session Redis backend must use separate keys and failure semantics |

## Parallel node decision

The new YAML node is a graph construct, not concurrent subagent dispatch. Its
strict definition, bounded runner and deterministic join are implemented in
`src/agents/graph/{yaml,parallel}.rs`. The first supported policy is
`wait: all` and fail-after-drain: already admitted siblings complete under the
same outer lease, and the reducer receives results in declared branch order.
The full YAML compiler still has to build branch graph plans before this node is
reachable from a production application.

ADK 2.0.0's deferred tracker and timeout origins are not part of `Checkpoint`.
Elitea therefore does not compile this feature as native deferred fan-in and
does not use `NodeContext::run_node_with`, whose child ledger is saved only
after the parent returns. Each branch is a small ADK `CompiledGraph` with a
claim-fenced descendant checkpoint thread. ADK writes the child's terminal
empty-frontier checkpoint before its invocation returns. After a crash, the
same parent activation reopens completed children at terminal state and runs
only unfinished children. The child thread digest binds the opaque execution,
generation and graph definition, root thread, parent step, complete parallel
configuration, branch ID, target, ordinal and bounded canonical projected-input
digest. A later loop visit or changed branch input therefore cannot consume an
earlier result.

The upstream action `WaitAll` implementation is not used as the reducer. It
accepts whatever `branch:*` keys happen to exist, does not prove the expected
branch set, and collects hash-map iteration order rather than YAML declaration
order. Elitea keeps the useful wait-all concept while enforcing the stronger
expected-set and deterministic-order contract at its adapter boundary.

Action `WaitAny` and `WaitN` only inspect results already present after a graph
frontier. They do not wake early or cancel siblings. YAML `wait: one` and
`wait: many` therefore fail validation until a separate scheduler persists its
completed set/deadline, provides a timer wakeup, and defines durable sibling
cancellation and late-result handling.

V1 requires the future production branch compiler to reject plans that can
pause for HITL, sensitive-tool approval or MCP authorization; the compiler seam
and pre-execution rejection proof are present in this core slice. ADK can
persist an inner interrupt before the parent has durably published it;
supporting that crash gap requires the later Elitea interrupt ledger keyed by
the current interrupt identity. External side effects remain at-least-once
between an effect and the following child checkpoint, so tool and effect
fencing remains mandatory.

## Performance and operations

The scaling foundation is bounded asynchronous admission, shared pools,
per-resource concurrency ceilings, backpressure and one owner for each durable
delivery. The internal invocation supervisor now accepts work only with a
non-cloneable reservation from its exact bounded admission pool, keeps accepted
work alive when a result waiter disappears, closes admission during drain and
returns an unaccepted authority-bearing future intact. The process panic hook
also replaces arbitrary panic payloads with one static diagnostic. This does
not yet authorize or execute a production capability; the complete lifecycle
owner remains the next composition gate. `smallvec`, `crossbeam` and lock-free
queues are not architecture requirements. Add them only after representative
profiles identify an allocation or contention hot path and a benchmark proves
an end-to-end gain without weakening cancellation or durability.

Tracing is added at the orchestration owner as functionality lands. Stable
span fields include execution/generation/claim attempt, capability, graph/node,
tool and function-call identity. Prompts, credentials, tool payloads,
checkpoint state and provider response bodies are never log fields. Low-level
adapters return typed errors with stable code and retryability; the lifecycle
owner records the error and its trusted source once.
