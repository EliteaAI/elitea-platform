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
| Agent and runner | `LlmAgent`, `Runner`, `RunnerConfig`, `Event` | Adopt behind the sealed one-shot invocation state | Main claim/authorize fence, supervised lifetime, progress/terminal output and Redis retirement remain Elitea-owned. The capability-disabled native lifecycle now composes that complete owner for the ordinary-text application/ad-hoc profile. One shared strict assembler consumes the post-authorization PAT once, selects the frozen OpenAI-chat or native-Anthropic dialect on the existing Main model gateway, and builds an invocation-local `LlmAgent`, frozen-text-history session and exclusive `Runner`; rich history, tools and capability registration remain closed |
| Event stream | `EventStream`, `Event`, `Content`, `Part` | Adopt as internal semantic input, not as the browser/output contract | The closed ordinary-text projector maps bounded root-model text/thinking events to current `NodeEventV1` shapes and drains through EOS. Elitea's capability-disabled lifecycle retains the exact command-bound cursor, encrypted spool, live or restored session, one pending frame and the 1..8 attempt budget while it ACKs each projected batch before polling ADK again. It hashes the exact canonical `full_message` JSON before its first await; only its bound durable ACK can produce the request-bound terminal at `N + 1`. The owner then performs final Renew -> Observe, applies fatal lease > durable Stop > inclusive deadline > ADK completion, durably ACKs the terminal, prepares settlement and atomically retires the exact Redis delivery. Production sanitizers and provider/session/tool/skill/HITL/MCP/application assembly remain gates |
| Graph/tool custom progress | Functional `TaskContext::emit(StreamEvent::custom(...))`, graph `NodeOutput.events`, and `ToolContext::emit_progress` | Wrap; never treat raw JSON or broadcast delivery as authoritative output | Useful for allowlisted pipeline and later indexing semantic events. Functional `emit` uses a Tokio broadcast sender and silently has no effect without listeners, so durable indexing/progress must still pass through the Elitea spool/send/ACK coordinator with schema, size and redaction policy. Tool progress already enters the ADK event stream but remains gated until its call identity and current browser shape are mapped |
| Models | Provider-neutral `Llm`; OpenAI/OpenAI-compatible in `adk-model`, with the `anthropic` feature delegating native types/protocol support to the separate `adk-anthropic` crate | Adopt semantic and native wire types; wrap only missing transport/identity policy | Construct a provider only after strict authorized profile admission consumes the claim-scoped PAT. Both capability-disabled adapters use the same existing Main LiteLLM/Bifrost-facing channel pool: `openai_compatible=true` and non-Claude names use `/llm/v1/chat/completions`, while `openai_compatible=false` Claude/Anthropic names use native `/llm/v1/messages`. ADK supplies `Llm`, response parts, `AnthropicSchemaAdapter`, `MessageCreateParams`, stream-event, caching and thinking types; Elitea owns origin binding, HTTP2/TLS policy, zeroized one-use credential, exact resource-project identity, bounded/redacted SSE, strict no-tool event state and completion proof. This is not another gateway. Exact ADK 2.0.0 provider clients construct their own unrestricted `reqwest::Client`, cannot inject the accepted Elitea channel/header policy, retain plain-string credentials, and can expose upstream bodies, so the worker does not instantiate them. The native adapter preserves the production-pinned SDK cache breakpoint/beta header and legacy/adaptive thinking behavior and adds Sonnet 4.6 to adaptive thinking, as supported by ADK-Rust 2.0.0: legacy `reasoning_effort=none` retains the SDK's fallback 4096-token thinking budget, while the invalid adaptive-none combination is rejected before PAT redemption. Streaming citations remain an explicit mapping gate because `adk-model` 2.0.0 logs `CitationsDelta` without projecting it and returns no terminal citation metadata; the worker therefore rejects them rather than silently dropping attribution. Bounded pre-stream retry and native tool/citation/context-management projection remain activation gates |
| Tools/toolsets | `Tool`, `Toolset`, `BasicToolset`, typed tool macro | Adopt and wrap | Elitea owns saved configuration, selected-tool identity, grants, sensitive policy, absolute deadline, bounded concurrency and result projection. The capability-disabled GitHub reference family parses the claim-materialized SDK shape and shares one invocation-scoped pooled client between its real probe and twenty explicitly selected native ADK reads: identity, branches, single/batch text files, bounded grep, base/active/directory repository navigation, issue query/detail/search, pull-request list/detail/file inspection, commit list/detail/compare, server-side code search, workflow-run status and one Project V2 snapshot. It preserves the SDK's 1-indexed slicing, 200,000-character guidance, cumulative skip, recursive Git-tree, callable issue/PR/commit/search/workflow/project schemas and success field meaning while moving retry ownership out of the blocking SDK helper and bounding paths, decoded files, tree completeness, issue pages, PR details/files, commit pages, patches, regex/search work, workflow jobs, GraphQL collections and diagnostics. Rust intentionally returns typed PR comment/commit arrays, canonical UTC commit filters, complete bounded commit projections, actual code-search completeness, one direct search page, explicit workflow/project truncation and one fixed Project query instead of Python-repr strings, unchecked time ranges, silently incomplete collections, lazy-page replay or partial GraphQL data. Empty GitHub selection still rejects the unported catalog. Google Places adds both current reads with one invocation-scoped pool and supported Places API (New), removing the SDK's global key and duplicate Details fanout. Sonar adds its complete single read as one exact project-bound `/api/issues/search` request: a versioned filter allowlist, fixed scope, bounded raw JSON and stable safe errors replace the SDK's global session, endpoint escape, redirects and traceback-bearing failures. Main retains public check/auth/revision/audit ownership; neither Google nor Sonar declares a probe. Live dispatch, authorized family materialization, Google attribution/persisted-content policy, restricted-key component proof, real Sonar TLS/project-isolation proof, the remaining GitHub tools, App installation auth, HITL and indexing remain gates |
| Sessions | `SessionService` and Runner session integration | Adopt interface, replace persistence where required | The capability-disabled ordinary profile uses one fresh `InMemorySessionService`, stable pseudonymous user/session identities and Main's exact frozen ordered text history, then Runner appends the current user message once. History is validated before PAT redemption, bounded to 999 prior messages so the current message remains inside ADK-Rust 2.0.0's 1000-message native-Anthropic request limit, and seeded as user/root-agent events without a persistent LangGraph-style transcript. Rich content, tool history, continuation, shared memory and compaction remain rejected until their exact current contracts are proven |
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
| Redis | ADK offers optional execution-state backends | Do not substitute | The restricted redis-rs transport owns Elitea command intake, PEL reclaim/heartbeat and exact post-settlement retirement. A crate-private generation owner now serializes explicit replacement after retryable failure without replaying an ambiguous command or allowing a late old-generation failure to evict the replacement. The fair worker serve loop, stop-aware TLS-material reload and real Redis 7 reconnect/reclaim system test remain. A later memory/session Redis backend must use separate keys and failure semantics |

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
also replaces arbitrary panic payloads with one static diagnostic. The
capability-disabled native application/ad-hoc lifecycle now owns one authorized
run through ADK EOS, per-event durable ACK backpressure, final lease and
deadline reduction, terminal ACK, settlement and Redis retirement. Its
ownership-heavy async phases are boxed at deliberate transition points so the
generated poll stack remains bounded without increasing thread stack sizes.
Cancellation-safe assembly and post-EOS result selection are raced against the
supervised lease. Exact ADK-Rust 2.0.0 creates its `EventStream` without I/O on
the first poll; the wrapper enforces that as a synchronous fail-closed start
boundary, while session lookup and agent work remain inside the supervised
stream.
Production capability registration still waits for real provider, session,
tool and policy assembly plus cross-process integration proof. `smallvec`,
`crossbeam` and lock-free queues are not architecture requirements. Add them
only after representative profiles identify an allocation or contention hot
path and a benchmark proves an end-to-end gain without weakening cancellation
or durability.

Tracing is added at the orchestration owner as functionality lands. Stable
span fields include execution/generation/claim attempt, capability, graph/node,
tool and function-call identity. Prompts, credentials, tool payloads,
checkpoint state and provider response bodies are never log fields. Low-level
adapters return typed errors with stable code and retryability; the lifecycle
owner records the error and its trusted source once.
