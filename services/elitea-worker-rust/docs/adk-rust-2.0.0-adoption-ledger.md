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
| Agent and runner | `LlmAgent`, `Runner`, `RunConfig`, `Event`, `AgentTool` | Adopt behind the sealed one-shot invocation state | Main claim/authorize fence, supervised lifetime, progress/terminal output and Redis retirement remain Elitea-owned. Application `agent_type=agent` and ad-hoc both build one direct invocation-local `LlmAgent`; configured native toolsets and variable-free saved direct children join the same loop, with children wrapped as `AgentTool`. Runtime/admin policy is projected into `require_tool_confirmation` on each owning `LlmAgent`. Stored pipelines remain graph-owned. The capability-disabled HITL continuation restores the exact persisted call in a second Runner without provider replanning: approved reads execute through fingerprint-bound `RunConfig`; denied calls emit one SDK-compatible blocked result with the original call ID through a no-effect adapter. Exact restart suffixes are recovered before or after result persistence, and the Runner-required marker is stripped before provider dispatch. Production continuation registration, approved-effect ownership, MCP authorization and active context management remain closed |
| Event stream | `EventStream`, `Event`, `Content`, `Part` | Adopt as internal semantic input, not as the browser/output contract | The projector maps bounded root-model text/thinking/tool events, exact direct confirmation pauses and dynamic graph HITL interrupts to current `NodeEventV1` shapes and drains through EOS. Sensitive inputs are retained privately for call identity but masked in every browser tool/interrupt frame. Elitea's capability-disabled lifecycle retains the exact command-bound cursor, encrypted spool, live or restored session, one pending frame and the 1..8 attempt budget while it ACKs each projected batch before polling ADK again. A pause is durably ACKed before `PAUSED_HITL` settlement. MCP/skill/static-breakpoint projection and authorized resume remain gates |
| Graph/tool custom progress | Functional `TaskContext::emit(StreamEvent::custom(...))`, graph `NodeOutput.events`, and `ToolContext::emit_progress` | Wrap; never treat raw JSON or broadcast delivery as authoritative output | Useful for allowlisted pipeline and later indexing semantic events. Functional `emit` uses a Tokio broadcast sender and silently has no effect without listeners, so durable indexing/progress must still pass through the Elitea spool/send/ACK coordinator with schema, size and redaction policy. Tool progress already enters the ADK event stream but remains gated until its call identity and current browser shape are mapped |
| Models | Provider-neutral `Llm`; OpenAI/OpenAI-compatible plus native Anthropic types | Adopt semantic/native wire types behind `ModelFacade`; wrap transport and identity policy | Construct a provider only after strict authorized profile admission consumes the claim-scoped PAT. `ModelFacade` selects the bounded OpenAI-compatible or native-Anthropic adapter over the existing Main pool and carries the frozen `model_project_id` independently from the claim actor/resource project. This intentionally fixes the SDK's execution-project substitution for shared/project-bound models. ADK supplies request/response/cache/thinking types; Elitea owns mTLS/origin, zeroizing token, model-project header, bounded/redacted SSE and exact completion. Native citations, active context management, bounded pre-stream retry and live platform proof remain gates |
| Tools/toolsets | `Tool`, `Toolset`, `BasicToolset`, typed tool macro | Adopt and wrap | Elitea owns saved configuration, selected-tool identity, grants, sensitive policy, absolute deadline, bounded concurrency and result projection. The capability-disabled GitHub reference family parses the claim-materialized SDK shape and shares one invocation-scoped pooled client between its real probe and twenty explicitly selected native ADK reads: identity, branches, single/batch text files, bounded grep, base/active/directory repository navigation, issue query/detail/search, pull-request list/detail/file inspection, commit list/detail/compare, server-side code search, workflow-run status and one Project V2 snapshot. It preserves the SDK's 1-indexed slicing, 200,000-character guidance, cumulative skip, recursive Git-tree, callable issue/PR/commit/search/workflow/project schemas and success field meaning while moving retry ownership out of the blocking SDK helper and bounding paths, decoded files, tree completeness, issue pages, PR details/files, commit pages, patches, regex/search work, workflow jobs, GraphQL collections and diagnostics. Rust intentionally returns typed PR comment/commit arrays, canonical UTC commit filters, complete bounded commit projections, actual code-search completeness, one direct search page, explicit workflow/project truncation and one fixed Project query instead of Python-repr strings, unchecked time ranges, silently incomplete collections, lazy-page replay or partial GraphQL data. Empty GitHub selection still rejects the unported catalog. Google Places adds both current reads with one invocation-scoped pool and supported Places API (New), removing the SDK's global key and duplicate Details fanout. Sonar adds its complete single read as one exact project-bound `/api/issues/search` request: a versioned filter allowlist, fixed scope, bounded raw JSON and stable safe errors replace the SDK's global session, endpoint escape, redirects and traceback-bearing failures. Azure Search adds both current SDK reads with a fixed configured-index authority and 2024-07-01 wire/result projection; Rust replaces `limit=-1` unbounded continuation fanout with one explicit 100-result request and omits the SDK's broken Azure OpenAI connection probe. Current `read`/`write`/`search`/`index` grouping remains orthogonal to sensitivity: deployment policy may require the shared exact-`interrupt_id` HITL flow for any tool. Main retains public check/auth/revision/audit ownership. Live dispatch, authorized family materialization, real provider component proofs, Google attribution/persisted-content policy, the remaining GitHub tools, App installation auth, shared HITL composition and indexing remain gates |
| Sessions | `SessionService` and Runner session integration | Adopt the interface with an Elitea PostgreSQL adapter | `src/state/postgres_session.rs` and agentstate migration `0002_agent_sessions.sql` implement a bounded `adk-session.2.0.0.v1` lineage in the separate `agentstate` database under `elitea_runtime`, leaving legacy LangGraph public tables untouched. It preserves complete ADK events, deterministic ordinals, app/user/session state tiers and exact event replay. Direct and graph agents both use this conversation/session contract; a graph agent additionally uses the separate `Checkpointer` contract for workflow frontier/state/interrupts. `AUTHORIZED_NOW` mints a non-cloneable session grant. Main's accepted control receipt supplies the database-authored claim start; the supervised lease becomes a read-only guard checked before state-writer locking and commit, while `agentstate` retains a durable newer-writer fence. Neither state adapter queries Main tables. This is a bounded, non-atomic two-database protocol rather than a distributed transaction. The common Runner accepts an injected PostgreSQL service, restoring an existing session or seeding deterministic frozen history once. Saved applications use their exact application/version identity for a secret-free definition lineage; ad-hoc chat keeps one lineage inside the already tenant/project/thread-scoped session so binding a different model/toolset does not discard conversation state. A second claimed direct-agent request persists an explicit replay marker because ADK 2.0.0 has no resume-without-user-event Runner API; the model adapter removes that marker from provider-visible contents. Partial replay restart is proven before tool/result and after the exact persisted result. Local PostgreSQL 18 component proof passes. Deployment bootstrap still selects the invocation-local backend; restricted pool/role wiring, cleanup-owner coverage, Main transcript cutover and deployed pooler/load proof remain gates |
| Context management | `EventsCompactionConfig`, `IntraCompactionConfig`, `BaseEventsSummarizer`, `LlmEventSummarizer`, feature-gated context-compaction strategy | Adopt through an explicit disabled-first owner after durable proof | `src/agents/context_management.rs` admits empty or master-disabled SDK settings and rejects active settings before PAT redemption. Future composition must freeze settings and summary-model authority in Main, preserve tool call/result pairs and nested/HITL/skill state, persist selected conversation events through the custom PostgreSQL `SessionService`, coordinate graph frontier changes through `Checkpointer` where applicable, and project conversation analytics. Existing originals are not considered safely retired merely because ADK can produce a summary |
| Observability | `tracing` instrumentation below ADK plus Elitea lifecycle spans | Wrap at orchestration/tool boundaries | The binary installs a crate-only level-filtered subscriber. Authenticated prepare/lifecycle, provider-neutral assembly, configured tool calls and nested `AgentTool` calls carry safe correlation, phase, outcome, duration and stable code fields. Prompts, arguments, results, URLs, credentials and provider bodies are excluded. OTLP/metrics export and deployed retention/cardinality policy remain the next local-platform gate |
| Checkpoints | `Checkpointer`; bundled SQLite implementation | Adopt exact trait with Elitea PostgreSQL backend | Implemented fresh native canonical-JSON-text lineage with current-claim fencing and shared pooling; invocation composition and cutover remain |
| Graph | `StateGraph`, custom `Node`, `interrupt_with_data`, deferred nodes, bounded compiled concurrency | Adopt compiler substrate | The bounded `parallel` core and one strict stored `type: hitl` node contract are implemented. Pipeline HITL uses ADK dynamic checkpoint/resume, exact definition digests, one-use private decisions and fail-closed routes; `EliteaGraphAgent` repairs root/invocation identity before browser projection. Elitea still owns whole-YAML compilation, authorized PostgreSQL resume injection, static breakpoint semantics, reducers, policy and durable fan-in extension |
| Fixed subagents | `SequentialAgent`, `LoopAgent`, `ParallelAgent` | Adopt where semantics match | Add an outer admission/cancellation policy. `ParallelAgent` is distinct from the new graph `parallel` node |
| MCP | HTTP clients, toolset and server manager behind optional feature | Wrap | Saved MCP admission, workload credentials, OAuth/HITL, bounded connections, name isolation, replay policy and external stdio runner remain Elitea-owned |
| Sensitive tools/HITL | `require_tool_confirmation`, call-ID decisions/fingerprints, dynamic graph interrupts/checkpoints | Compose | Initial direct-tool and pipeline pauses are implemented capability-disabled. Direct calls bind a fresh public `interrupt_id` to the ADK invocation, function-call ID, tool and canonical raw arguments while publishing only masked arguments; their complete in-turn transcript belongs in the fenced PostgreSQL `SessionService`. Runner persists the final call and confirmation events before yielding them, so pending direct state is restored from standard session events rather than a parallel interrupt table. Main atomically consumes the exact pending browser interrupt set; Rust strictly admits and rejoins the decision to the latest raw call. The ordinary assembler now selects that continuation before PAT redemption, requires a restorable session, uses a one-shot model adapter to emit the exact call without provider replanning, and lets native `RunConfig` confirmation plus `ToolExecutor` perform one metadata-proven read-only call before normal model continuation. It rejects every effectful tool and invocation-local continuation. Production registration remains closed, and a process loss after Runner appends the continuation user event but before the result is persisted still needs an explicit restart rule. Effectful calls additionally require durable intent/outcome receipts and reconciliation. Pipeline calls bind the public ID to thread, graph checkpoint and definition digest. Identical name and arguments can be a new call; neither arguments nor tool name alone authorize it. A separate receipt table remains unjustified until deterministic decision events/checkpoint transitions are proven insufficient |
| Action HTTP | Graph action creates a fresh unrestricted `reqwest::Client`, interpolates URL/auth and includes dependency text in errors | Do not enable directly | A future Elitea HTTP capability must enforce approved origins, DNS/IP/redirect policy, workload credential references, response/body bounds, deadlines and redacted errors; the ADK config/action shape may be reused behind it |
| Action database | ADK 2.0.0 validates config but its SQL/Mongo/Redis executors are explicit placeholders | Do not enable the placeholders | The current product SQL toolkit is implemented separately with backend-specific SQLx ownership, fixed claimed authority, bounded results and effect semantics; other database actions still require dedicated contracts |
| Action code / code tools | Optional action/code/sandbox feature families exist | Separate plan | Current code-node parity requires a reviewed isolation boundary, filesystem/network policy, resource metering and artifact contract; it is not enabled inside the main worker process by this replatform slice |
| Managed runtime | Optional `managed-runtime` exposes another lifecycle abstraction | Defer | Its façade is a useful shape, but the audited implementation keeps its checkpoint manager, sequence counter, parking lot and active channels in process. Injecting the PostgreSQL `SessionService` would persist conversation events, not the parked execution frame. Main plus the worker delivery coordinator therefore remain the only execution authority; revisit only as an internal adapter after proving restart-safe external checkpoint/parking injection cannot duplicate claims, settlement or recovery |
| Semantic memory | Optional memory service and database/Redis/SQLite backends | Defer and wrap | Define tenant/project/agent namespace, consent, retention, deletion, embedding/provider and poisoning policy before enabling global agent or graph memory |
| Realtime/voice | Optional realtime runner and transport/provider features | Defer and wrap | Map current voice/ASR/TTS session behavior, cancellation, quotas and `NodeEventV1`/media boundaries first; do not enable the enterprise preset |
| Redis | ADK offers optional execution-state backends | Do not substitute | The restricted redis-rs transport owns Elitea command intake, PEL reclaim/heartbeat and exact post-settlement retirement. A crate-private generation owner now serializes explicit replacement after retryable failure without replaying an ambiguous command or allowing a late old-generation failure to evict the replacement. The fair worker serve loop, stop-aware TLS-material reload and real Redis 7 reconnect/reclaim system test remain. A later memory/session Redis backend must use separate keys and failure semantics |

The toolset foundation also contains the complete capability-disabled
`ServiceNow` incident family: one bounded read plus create and update effects,
all backed by one invocation-scoped origin/credential pool and exact SDK result
projection. The effects are implemented rather than omitted. Production
composition remains closed until authorized materialization, provider proof and
the shared durable sensitive-tool pause path can bind the exact invocation.
Write activation additionally requires an owned cancellation-safe effect
identity/reconciliation boundary: dropping an ADK tool future must never turn
an accepted but response-lost remote mutation into an ordinary cancellation.

The complete capability-disabled `Salesforce` family adds six native ADK
tools in SDK order: two creates, one SOQL read, two updates and the generic
GET/POST/PATCH/DELETE escape hatch. One invocation-scoped client owns the
claim-materialized nested credential, lazy OAuth token, fixed HTTPS/version
root and bounded response projection. All effects are present, but production
composition remains closed until authorized materialization, provider proof,
the shared exact-`interrupt_id` sensitive-tool flow and a cancellation-safe
effect identity/reconciliation owner are composed. Operation grouping remains
model/catalog metadata and never grants execution authority.

The complete capability-disabled `Slack` family adds all seven current SDK
tools in source order: three messaging/membership effects and four bounded
conversation/workspace reads. One invocation-scoped zeroizing token owner uses
the fixed Slack Web API origin with no redirects or automatic retry. Rust
preserves configured-channel fallback and success projections while removing
the redundant history `auth.test`, bounding every first page and running
member-info fanout with an eight-request structured concurrency limit.
Selection-oriented tool and parameter descriptions are part of the tested
contract. Production composition remains closed until authorized application
and ad-hoc materialization, live Slack scope/rate-limit proof, the shared exact
`interrupt_id` sensitive-tool flow and a cancellation-safe effect
identity/reconciliation owner are composed; reads may be sensitive regardless
of their catalog group.

The complete capability-disabled `Rally` family adds all eight current SDK
tools in source order: six WSAPI reads plus create and update. One lazy,
invocation-scoped client owns the claim-materialized API key or Basic
credential and exact HTTPS origin; it replaces the SDK's eager class-global
`pyral` client. Reads use bounded first pages and structured query encoding,
Basic effects obtain a same-session security token, and neither effect is
retried after dispatch ambiguity. Tested descriptions expose type aliases,
query syntax, context fallback, field/identifier requirements, result shape
and effect risk to the model. Production composition remains closed until
authorized application/ad-hoc materialization, live Rally proof, the shared
exact-`interrupt_id` sensitive-tool flow and cancellation-safe effect
identity/reconciliation are composed. Read/write grouping remains metadata,
not approval authority.

The complete capability-disabled `GitLab Org` family is a separate toolkit
from the standard GitLab catalog and adds all seventeen current SDK operations
in source order: eight reads, eight writes and one delete. One claim-scoped,
zeroizing private-token client owns the accepted HTTPS GitLab origin and either
a strict configured project allowlist or the source-compatible dynamic-project
mode. Active-branch state is invocation-local and the complete toolset is
serialized so a concurrent model loop cannot race branch selection with a
repository effect. Rust preserves the current OLD/NEW file-edit and merge-
request diff-position functionality while bounding project pages, files,
commits, diffs, edits and results. The explicit limits include a 1 MiB decoded
read source, 200,000-character plus 512 KiB serialized read result, and 256 KiB
writable result/edit. It also fixes the SDK's eager construction I/O, unbounded
pagination, cross-project append, error-as-missing create probe and raw provider
failures. Production composition remains closed until Main binds dynamic mode
to explicit organization-wide repository authority, the
delegated GitLab connection check and live provider proof are composed, and the
shared exact-`interrupt_id` HITL plus cancellation-safe effect receipt/
reconciliation owner protects all remote effects. Operation grouping remains
metadata, so any GitLab read may also be configured as sensitive.

The complete capability-disabled `ReportPortal` family adds all nine current
SDK tools in source order. Every operation is a read: launch exports and
details, paged launch/item/log collections, individual test items, users and
dashboards. One invocation-scoped zeroizing Bearer client owns the
claim-materialized project and HTTPS origin, replaces the SDK's class-global
client, percent-encodes authority components, disables redirects and retries,
and bounds every request, response and tool result. Raw HTML is explicit UTF-8,
small raw PDF has an explicit base64 conformance fallback, and the readable
report uses a deterministic bounded HTML-to-text projection rather than the
SDK's broken PDF-as-HTML branch. The inline PDF bound is not the production
download architecture: large exports require durable artifact/object-store
streaming and a reference result before activation. Generic PDF analysis should
extract text page by page and render only scanned or visually relevant pages for
a multimodal model, rather than rasterizing every page by default. Tested
descriptions expose the operation, identifier, page/format
default, bounds and result shape without leaking endpoint or project details.
Production composition remains closed until authorized application/ad-hoc
materialization, approved egress, configuration-catalog projection, durable
large-export artifact streaming and a live provider proof are composed.
Although no effect owner is required, any report,
log or user read may independently require the shared exact-`interrupt_id`
sensitive-tool policy.

The complete capability-disabled `Aha` family adds all thirty-three current
SDK tools in source order: 25 REST/GraphQL/search/metadata reads, six writes,
one delete and the legacy combined create/update/delete execute surface. The
current and worker-pinned SDK implementations are functionally identical;
current adds only operation-group metadata. One invocation-scoped zeroizing
Bearer client owns the claim-materialized HTTPS account origin, disables
redirects and retries, validates expected pagination collections and bounds
every page, body, JSON value, formatter result and diagnostic. Native
deterministic JSON/CSV/Markdown replaces optional pandas/tabulate behavior.
Record parent scopes, GraphQL Markdown reads, comments, all seven link codes,
release duplication, custom-field metadata and every mutation are retained.
The combined `manage_record` is authorized according to its exact requested
action rather than its generic `execute` label. `attach_file` accepts only an
authorized Elitea `/{bucket}/{filename}` artifact reference: content is
downloaded to a private bounded temp spool, immutable version/length/SHA-256
are verified before dispatch, then the verified file is streamed once as
multipart `attachment[data]`. This preserves files below Aha's 300 MB provider
limit without a same-sized memory buffer. Production composition remains
closed until authorized application/ad-hoc materialization, live Aha egress and
connection proof, the sealed artifact resolver plus shared disk/concurrency
budget, exact-`interrupt_id` sensitive-tool continuation and cancellation-safe
effect receipt/reconciliation are composed. Any read may be sensitive; group
metadata grants no authority.

The complete capability-disabled `SQL` family adds both current SDK actions:
one unrestricted committed statement executor and one default-schema table/
column discovery read. PostgreSQL and MySQL have separate SQLx connection and
row projection paths so normal decimal, temporal, UUID, JSON, binary and array
results are not narrowed to SQLx `Any` primitives. Rust repairs the registered
integer-port mismatch, replaces credential-bearing DSNs and unbounded
reflection fanout, enforces a single bounded statement and finite results, and
never echoes SQL or database authority. MySQL keeps the provider's existing
session SQL mode and rejects `NO_BACKSLASH_ESCAPES` before user-statement
dispatch instead of silently replacing tenant policy. `execute_sql` is always an effect;
post-dispatch failure is a nonretryable unknown outcome. Production composition
remains closed until application/ad-hoc materialization, exact-`interrupt_id`
approval, cancellation-safe effect reconciliation, owned TLS/trust, real
PostgreSQL/MySQL proof and a response preallocation boundary are composed.

The complete capability-disabled `Postman` family adds all thirty-one current
SDK tools in source order: eight reads, nineteen writes, three deletes and one
stored-request execute surface. One claim-scoped zeroizing client owns only the
configured Postman HTTPS management origin and disables redirects and hidden
retries. Collection traversal, request/folder resolution, JSON bodies, provider
responses and projections are bounded. The SDK's deterministic analyzer is
retained for collection, folder and request security, performance,
documentation, testing, issue, score, recommendation and improvement results;
read projections redact stored credentials and payload values without changing
raw-field search matching. All management mutations are implemented but remain
closed behind exact-`interrupt_id` sensitivity, durable per-collection fencing
and cancellation-safe effect receipt/reconciliation. `execute_request` has a
separate structurally closed dynamic-egress authority because reading a saved
Postman URL cannot authorize downstream HTTP. Activation additionally requires
claim-bound origin and DNS authorization, SSRF and redirect controls, dangerous
header filtering, secret-safe output, and a distinct downstream effect receipt.
The disabled executor preserves request-level auth fallback and commented-JSON
behavior without inheriting broader collection/folder credentials or corrupting
quoted `//` URL text.
No public connection check is advertised: the configuration contract marks it
unsupported and the source toolkit's nominal checker addresses fields that do
not exist on its generated nested model.

The complete capability-disabled `Yagmail` family adds its one current SDK
`send_gmail_message` write effect from inline claim-materialized settings. A
non-debuggable zeroizing client owns the frozen DNS host, username and password;
implicit TLS port 465 verifies native roots and hostname, SMTP authentication
supports the source mechanisms, and the bounded MIME builder always treats the
message as literal text rather than a local path. The client makes one send
attempt, returns the source empty object on complete acceptance, reports partial
recipient refusal without diagnostic text, and converts every ambiguous failure
after DATA begins to a nonretryable unknown outcome. Rust intentionally makes
`cc` optional-null, matching the Python method/runtime default rather than its
accidentally required generated schema. Production composition remains closed
until exact-`interrupt_id` approval, a durable pre-send Message-ID intent and
effect receipt/reconciliation owner, claim-only secret redemption, fixed-host
SMTP egress/DNS enforcement and live verified-TLS proof are composed. The
`write` group alone grants no authority and sensitivity remains independent.

The complete capability-disabled `Keycloak` family adds its one current SDK
generic Admin REST `execute` operation from inline claim-materialized settings.
All bounded HTTP method tokens remain available, so reads, writes, deletes and
action endpoints are not omitted. One non-debuggable invocation client owns the
frozen HTTPS origin/context path, realm, client ID and zeroizing client secret;
each call makes one client-credentials token request and one Bearer Admin API
request with no redirects, hidden retries or token refresh. Rust deliberately
separates form credentials from Admin Bearer auth, replacing the SDK session's
Basic/Bearer collision, and accepts only a strict bounded JSON-object body rather
than single-quote rewriting. Tool metadata explains path/query/body semantics,
confidential reads, effect scope, response limits and unknown-outcome retry risk.
Production composition remains closed until exact-`interrupt_id` approval,
durable effect intent/receipt reconciliation, claim-only secret redemption,
fixed-origin DNS/IP egress enforcement and live Keycloak role/provider proof are
composed. The `execute` group is metadata and grants no authority.

The complete capability-disabled `Azure Resource Manager` family adds both current SDK cloud
operations in source order: the generic ARM `execute` surface and its read-only
resource-group health tool. One invocation-scoped client owns the frozen
public-cloud subscription plus zeroizing Microsoft Entra client secret, admits
the exact subscription-scoped `management.azure.com` authority, obtains one
client-credentials token, and performs one bounded Bearer request with no
redirect or automatic retry. Rust deliberately repairs the SDK's missing JSON
and domain helpers, replaces unscoped request kwargs with explicit bounded
headers/query/JSON/form/inline-multipart options, and never interprets a file
value as a local path. All bounded HTTP method tokens remain available, so
write, delete and action endpoints are not omitted. Tested descriptions explain
the absolute URL/API-version contract, option shapes, confidential reads,
effect risk, 512 KiB result ceiling, one-attempt behavior and reconciliation.
Production composition remains closed until exact-`interrupt_id` approval,
durable effect intent/receipt reconciliation, claim-only secret redemption,
public-cloud DNS/IP egress enforcement and live Azure role proof are composed.
The `execute`/`read` groups remain metadata and grant no authority.

The complete capability-disabled `Elasticsearch` family adds its one current
SDK `search_elastic_index` read from inline claim-materialized settings. One
invocation-owned client binds an exact verified-TLS cluster origin and optional
zeroizing encoded API key, performs one bounded `POST /{index}/_search`, and
never inherits proxy, redirect, retry or disabled-certificate behavior. Rust
deliberately repairs the missing Python dependency, string-versus-tuple API-key
mismatch and class-global client. The Query DSL object, index expressions,
result window, provider body and 512 KiB model result are bounded while the
native search response remains intact. Tested descriptions explain
Elasticsearch and REST-compatible OpenSearch targeting, wildcard and comma
forms, Query DSL shape and post-7.10.2 divergence, first-response-only behavior,
confidential-data risk and expensive-query cues. The shared search wire works
with anonymous or compatible API-key OpenSearch clusters; Basic-authenticated
and Amazon SigV4 domains remain explicit unsupported activation gaps.
Production composition remains closed until claim-only materialization, exact
cluster DNS/IP egress and live authentication, index-privilege and query-load
proof are composed. The `read` group remains metadata and sensitivity stays
independent.

The complete capability-disabled `GCP` family adds the current SDK's one
generic `execute_request` operation from inline claim-materialized
service-account JSON. One invocation-owned client validates and zeroizes the
PKCS#8 key, signs a one-hour RS256 JWT for one to thirty-two explicit official
Google OAuth scopes, exchanges it at the fixed token endpoint, and sends one
bounded Bearer request only to `googleapis.com` or a subdomain. It inherits no
ambient credential, proxy or redirect authority and performs no automatic
retry. Every bounded HTTP method token remains available, so reads, writes,
deletes and action endpoints are not omitted. Tested descriptions explain the
scope/origin contract, option shapes, confidential-read risk, 512 KiB result
ceiling, 202 semantics, one-attempt behavior and reconciliation. Production
composition remains closed until exact-`interrupt_id` approval, durable effect
intent/receipt reconciliation, claim-only key redemption, Google OAuth/API
DNS/IP egress enforcement and live service-account role proof are composed.
The `execute` group remains metadata and grants no authority.

The complete capability-disabled `Kubernetes` family adds both current SDK
cloud operations in source order: generic `execute_kubernetes` and the
read-only `/version` health tool. One invocation-owned client requires the
claim-materialized exact HTTPS cluster origin and zeroizing Bearer token,
verifies native-root TLS, rejects redirects and ambient proxy/kubeconfig
authority, and performs one bounded request without automatic retry. Rust
deliberately repairs disabled certificate verification, class-global client
state, object inputs passed through `json.loads`, status-blind health and raw
provider errors. Every bounded HTTP method token remains available, so writes,
deletes, patches and action subresources are not omitted. Tested descriptions
explain the exact sub-URL/query contract, body/header shapes, patch media type,
confidential reads, 512 KiB result ceiling, 202 semantics, one-attempt behavior
and reconciliation. Production composition remains closed until exact-
`interrupt_id` approval, durable effect intent/receipt reconciliation,
claim-only token redemption, cluster DNS/IP plus certificate authority policy,
and live RBAC proof are composed. The `execute`/`read` groups remain metadata
and grant no authority.

The complete capability-disabled legacy `Zephyr` family adds all four current
SDK tools in source order: one test-step read and three single/batch append
effects. This toolkit uses inline Basic-auth settings and is deliberately
separate from the configured, indexing-backed `zephyr_scale` family and the
fixed-cloud Zephyr Squad family. One invocation-owned client binds the frozen
HTTPS ZAPI prefix, verifies TLS, disables redirects, proxies and retries, and
performs one bounded GET or POST per step. Batch inputs are completely
prevalidated and limited to 50 steps per case, 20 cases, 100 total steps and a
64-KiB encoded JSON string before sequential dispatch. Tested descriptions
explain exact input shapes, selection cues, duplicate/partial-effect risk and
reconciliation; compact batch receipts avoid echoing the model's payload.
Production composition remains closed until authorized application/ad-hoc
materialization, approved endpoint egress, a harmless live legacy-ZAPI read,
the shared exact-`interrupt_id` sensitive-tool flow and durable single/partial
effect receipts are composed. The read/write groups remain metadata and grant
no authority.

The complete capability-disabled `Zephyr Squad` family adds all fifteen
current SDK tools in source order: five reads, eight writes and two deletes
covering test steps, BDD content, cycles, folders and executions. Its inline
claim-materialized account/access/secret settings remain distinct from the
separately configured Zephyr variants. One invocation-scoped client signs the
exact fixed-origin route with a five-minute HS256 JWT, preserves query order
for QSH, disables redirects and retries, and bounds JSON objects, response
bodies and model output. All effects are implemented, but production
composition remains closed until authorized application/ad-hoc
materialization, a harmless live credential read, the shared exact
`interrupt_id` sensitive-tool flow and cancellation-safe effect
identity/reconciliation are composed. Read/write/delete grouping is catalog
metadata and never grants effect authority.

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
