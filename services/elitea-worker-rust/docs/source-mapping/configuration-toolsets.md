# Configuration and toolset source mapping

The SDK snapshot registers 32 configuration families, 18 connection checks and
45 concrete standard toolkit classes with 619 fixed tool schemas. OpenAPI,
MCP, application and other runtime toolsets are dynamic. Rust will use immutable
configuration/toolset instances and one invocation kernel shared by direct
toolkit tests and ADK agent execution.

Target convention:

- public configuration descriptor/registry: `src/configurations/families/<family>.rs`
- claim-materialized runtime configuration: co-located as
  `src/toolkits/families/<family>/config.rs` when it exists only to construct
  that family's client
- toolset: `src/toolkits/families/<family>/{mod.rs,client.rs,tools.rs}`
- tests: co-located capability-gated unit contracts first, followed by
  `tests/configurations/<family>.rs` and
  `tests/toolkits/<family>_{catalog,materialization,invocation}.rs` when the
  public registry and cross-process composition land

## Frozen agent-tool snapshot boundary

The first Rust tool slice validates the immutable references admitted with an
agent request; it does not instantiate a toolkit. Main remains responsible for
freezing configuration settings into reference form. Rust borrows those JSON
documents from the owned request, applies explicit count/identifier bounds and
classifies configured, MCP and nested-application references without cloning or
formatting the settings.

The authoritative list depends on the current command kind:

- application execution reads `application.version_details.tools` and requires
  the top-level `tools` list to be empty;
- ad-hoc execution reads the top-level `tools` list and rejects a second nested
  nonempty list;
- the first reference with a non-null toolkit ID wins, matching the current SDK
  deduplication rule. Identity-only ad-hoc application references have a null
  toolkit ID and remain distinct.

The snapshot is bounded to 1,024 references, 1,024 selected/excluded tool names
per reference and 1,024 bytes per common identifier, in addition to the input
protocol's 256 KiB per-JSON-value, 64-level nesting and 64 KiB string limits.
Positive identifiers must fit PostgreSQL/Go signed 64-bit counters. These are
worker hardening bounds, not a claim that the UI supports that many active
tools.

| Source evidence | Business responsibility | Rust target | Status / deviation |
| --- | --- | --- | --- |
| Main `internal/application/agentexecution/tools.go::CurrentApplicationToolSnapshotService.FreezeCurrentApplicationVersion` | Freeze configured settings as references, preserve selected tools, assign the stable toolkit name and keep nested-application settings identity-only | `src/toolkits/snapshot.rs::FrozenToolSnapshot` | Implemented validation foundation; settings remain sealed and borrowed |
| Main `internal/application/agentexecution/start.go::currentApplicationInput` and `adhoc.go::currentAdhocInput` | Put application tools in frozen version details and ad-hoc tools at the top level | `FrozenToolSnapshot::from_request` | Implemented as one unambiguous source per request kind |
| Python worker `agents/sdk_adapter.py::EliteaSdkAgentAdapter::{execute_application,execute_adhoc}` | Carry the selected snapshot and claim-scoped MCP/HITL inputs into the SDK execution path | future authorized materializer | Snapshot only; no PAT, MCP token or toolkit client is created here |
| Legacy indexer worker `methods/indexer_agent.py::_indexer_agent_task_inner` and `methods/indexer_predict_agent.py::_indexer_predict_agent_task_inner` | Historical application/ad-hoc selection, MCP secret expansion and SDK invocation behavior | source evidence for materialization and compatibility tests | Intentional deviation: Rust will redeem credentials at the authorized use boundary instead of mutating copied dictionaries before SDK construction |
| SDK `runtime/toolkits/tools.py::get_tools` | Sanitize references, first-ID-wins deduplication, family dispatch, blocked-tool policy, MCP smart-auth and nested applications | `src/toolkits/{snapshot,materialize,policy}.rs` | Deduplication/classification and immutable blocklist implemented; materialization, MCP and application execution remain capability-gated |

Evidence was refreshed against the platform/Python worker commit
`23e652a355c1a9735855d17d8cc0b1ddddcbbd70`, SDK commit
`c0443b175adb8437e89826c17150330e32074faf`, and legacy indexer-worker commit
`b6c4ce83d997acbbbeb58fe040317a9e9352236f` on 2026-08-18. Later slices must
refresh these pins because all three Python sources continue to evolve.

### Immutable blocklist generation

`src/toolkits/policy.rs::ToolAdmissionPolicy` implements the current SDK's
case-, prefix- and separator-insensitive blocklist membership without its
mutable module globals. One immutable policy generation is intended to be held
by `Arc`: reconfiguration swaps the generation for new work, while an in-flight
invocation finishes under the exact policy that admitted it. The future serve
composition owns that swap; this slice does not read process environment or
Main configuration directly.

Whole-toolkit restrictions filter the frozen snapshot before any credential or
client can be materialized. Specific-tool restrictions are evaluated again on
the concrete ADK tool name, including `toolkit___name` and `toolkit:name`
aliases. They remain toolkit-scoped: the current blocked-tool contract does not
apply the sensitive-policy `*` wildcard globally. Separator-only entries are
ignored, matching SDK behavior. The policy is capped at 16,384 configured
identifiers and 1,024 bytes per identifier, and errors expose no configured
names.

Source ownership is split deliberately:

- Main `internal/api/v2/admin/config_schemas.go::guardrailsSection` describes
  the operator-facing `toolkit_security` shape;
- legacy indexer worker `module.py::Method._apply_toolkit_security` proves live
  reconfiguration and the current in-flight snapshot behavior;
- SDK `runtime/toolkits/security.py` and
  `tests/runtime/test_blocked_tools.py` define canonical name and alias matching;
- Rust owns the immutable policy generation and will apply the same value at
  materialization and invocation boundaries.

This is a static deny policy, not sensitive-action authorization. Sensitive
tools, MCP smart auth and direct HITL retain their separate durable invocation
identity and `interrupt_id` state machines.

## Shared kernel mapping

| Python source | Responsibility | Rust target | Proof | Status / deviation |
| --- | --- | --- | --- | --- |
| SDK `configurations/__init__.py` | Configuration registry and schemas | `src/configurations/registry.rs`, family modules | Registry/catalog golden and schema differential tests | Planned |
| SDK `tools/__init__.py::{toolkit_config_schema,get_tools}` | Toolkit registry, selected tools, dispatch, blocked tools and metadata | `src/toolkits/registry.rs`, `src/toolkits/materialize.rs` | Complete family/tool inventory and invalid-selection tests | Planned |
| SDK `runtime/toolkits/tools.py::get_tools` | Runtime toolsets before standard/community dispatch | `src/toolkits/materialize.rs` | Runtime/family dispatch tests | Planned |
| SDK `tools/base/tool.py::BaseAction` and `tools/elitea_base.py::BaseToolApiWrapper.run` | Map selected tool name to bounded invocation | `src/toolkits/invocation.rs` | Native ADK metadata, top-level null normalization, bounds, cancellation and safe-error tests | Implemented shared kernel; family operations remain planned |
| SDK `runtime/toolkits/security.py` | Separator-insensitive blocked toolkit/tool policy | `src/toolkits/policy.rs` | Alias, scope, bound and pre-materialization filter corpus | Implemented foundation; serve-time config generation swap remains planned |
| SDK `runtime/middleware/sensitive_tool_guard.py` | Sensitive effect admission | `src/agents/sensitive_tools.rs` | Exact invocation-ID and at-most-once tests | Planned |

## Family inventory

`Check` means the Python configuration implements a live or authorization-aware
`check_connection`. Tool counts exclude dynamic OpenAPI/MCP/application tools.
Indexing tools are recorded as a later overlay in `indexing.md`.

| Configuration family | Python configuration symbol | Python toolkit symbol(s) | Fixed tools | Check | Rust targets | Status / notable gate |
| --- | --- | --- | ---: | :---: | --- | --- |
| `github` | `configurations/github.py::GithubConfiguration` | `tools/github::EliteAGitHubToolkit` | 44 | Yes | `toolkits/families/github/{config,client,tools}.rs`; future public descriptor | Capability-disabled foundation: strict anonymous/PAT/basic/App probe parsing plus explicit `get_me`, `list_branches_in_repo`, `read_file`, `read_multiple_files`, and `grep_file`; the other 39 tools, App installation auth, sensitive effects, indexing overlay and live composition remain gates |
| `ado` | `configurations/ado.py::AdoConfiguration` | `tools/ado` dispatcher; repos, plans, boards, wiki toolkits | 74 | Yes | `configurations/families/ado.rs`; `toolkits/families/ado/` | Planned; one owner for shared auth/client and aliases |
| `gitlab` | `configurations/gitlab.py::GitlabConfiguration` | `EliteAGitlabToolkit`, GitLab Org toolkit | 44 | Yes | `configurations/families/gitlab.rs`; `toolkits/families/gitlab/` | Planned; standard and org stay together |
| `qtest` | `configurations/qtest.py::QtestConfiguration` | `tools/qtest::QtestToolkit` | 25 | Yes | `configurations/families/qtest.rs`; `toolkits/families/qtest/` | Planned |
| `bitbucket` | `configurations/bitbucket.py::BitbucketConfiguration` | `tools/bitbucket::EliteABitbucketToolkit` | 22 | Yes | `configurations/families/bitbucket.rs`; `toolkits/families/bitbucket/` | Planned |
| `confluence` | `configurations/confluence.py::ConfluenceConfiguration` | `tools/confluence::ConfluenceToolkit` | 25 | Yes | `configurations/families/confluence.rs`; `toolkits/families/confluence/` | Planned; shared Atlassian auth normalizer |
| `jira` | `configurations/jira.py::JiraConfiguration` | `tools/jira::JiraToolkit` | 23 | Yes | `configurations/families/jira.rs`; `toolkits/families/jira/` | Planned; shared Atlassian auth normalizer |
| `postman` | `configurations/postman.py::PostmanConfiguration` | `tools/postman::PostmanToolkit` | 31 | No | `configurations/families/postman.rs`; `toolkits/families/postman/` | Planned |
| `service_now` | `configurations/service_now.py::ServiceNowConfiguration` | `tools/servicenow::ServiceNowToolkit` | 3 | No | `configurations/families/service_now.rs`; `toolkits/families/service_now/` | Planned; source has no focused family tests |
| `testrail` | `configurations/testrail.py::TestRailConfiguration` | `tools/testrail::TestrailToolkit` | 23 | Yes | `configurations/families/testrail.rs`; `toolkits/families/testrail/` | Planned |
| `slack` | `configurations/slack.py::SlackConfiguration` | `tools/slack::SlackToolkit` | 7 | No | `configurations/families/slack.rs`; `toolkits/families/slack/` | Planned |
| `azure_search` | `configurations/azure_search.py::AzureSearchConfiguration` | `tools/azure_ai/search::AzureSearchToolkit` | 2 | No | `configurations/families/azure_search.rs`; `toolkits/families/azure_search/` | Planned |
| `delta_lake` | `configurations/delta_lake.py::DeltaLakeConfiguration` | `tools/aws/delta_lake::DeltaLakeToolkit` | 3 | No | `configurations/families/delta_lake.rs`; `toolkits/families/delta_lake/` | Planned; source has no focused family tests |
| `bigquery` | `configurations/bigquery.py::BigQueryConfiguration` | `tools/google/bigquery::BigQueryToolkit` | 11 | No | `configurations/families/bigquery.rs`; `toolkits/families/bigquery/` | Planned; source has no focused family tests |
| `xray` | `configurations/xray.py::XrayConfiguration` | `tools/xray::XrayToolkit` as `xray_cloud` | 12 | Yes | `configurations/families/xray.rs`; `toolkits/families/xray/` | Planned; preserve runtime alias |
| `zephyr` | `configurations/zephyr.py::ZephyrConfiguration` | Zephyr and Zephyr Scale | 30 | No | `configurations/families/zephyr.rs`; `toolkits/families/zephyr/` | Planned; all Zephyr variants one batch |
| `zephyr_enterprise` | `ZephyrEnterpriseConfiguration` | `ZephyrEnterpriseToolkit` | 11 | Yes | corresponding family paths | Planned; source has no focused family tests |
| `zephyr_essential` | `ZephyrEssentialConfiguration` | `ZephyrEssentialToolkit` | 51 | Yes | corresponding family paths | Planned; largest fixed catalog, no focused tests |
| `figma` | `configurations/figma.py::FigmaConfiguration` | `tools/figma::FigmaToolkit` | 17 | Yes | corresponding family paths | Planned; content/artifact limits required |
| `rally` | `configurations/rally.py::RallyConfiguration` | `tools/rally::RallyToolkit` | 8 | No | corresponding family paths | Planned; source has no focused family tests |
| `sonar` | `configurations/sonar.py::SonarConfiguration` | `tools/code/sonar::SonarToolkit` | 1 | No | corresponding family paths | Planned |
| `sql` | `configurations/sql.py::SqlConfiguration` | `tools/sql::SQLToolkit` | 2 | No | corresponding family paths | Planned; dialect/driver and query policy required |
| `google_places` | `GooglePlacesConfiguration` | `GooglePlacesToolkit` | 2 | No | corresponding family paths | Planned; source has no focused family tests |
| `salesforce` | `SalesforceConfiguration` | `SalesforceToolkit` | 6 | No | corresponding family paths | Planned; source has no focused family tests |
| `sharepoint` | `SharepointConfiguration` | `SharepointToolkit` | 28 | Yes | corresponding family paths | Planned; delegated/app-only auth and content limits |
| `carrier` | `CarrierConfiguration` | `EliteACarrierToolkit` | 18 | No | corresponding family paths | Planned; source has no focused family tests |
| `report_portal` | `ReportPortalConfiguration` | `ReportPortalToolkit` | 9 | Yes | corresponding family paths | Planned; source has no focused family tests |
| `testio` | `TestIOConfiguration` | `TestIOToolkit` | 15 | Yes | corresponding family paths | Planned; source has no focused family tests |
| `openapi` | `OpenApiConfiguration` | `EliteAOpenAPIToolkit`, dynamic `OpenApiAction` | Dynamic | Yes | `configurations/families/openapi.rs`; `toolkits/families/openapi/` | Planned; specification parser/schema/auth is its own program |
| `langfuse` | `LangfuseConfiguration` | No standard toolkit | 0 | Yes | `configurations/families/langfuse.rs` | Planned; observability support configuration |
| `aha` | `AhaConfiguration` | `AhaToolkit` | 33 | Yes | corresponding family paths | Planned |
| `pgvector` | `PgVectorConfiguration` | No standalone toolkit | 0 | No | `configurations/families/pgvector.rs` | Planned; shared indexing/runtime dependency |

Additional standard toolkits without a registered same-named configuration are
tracked separately: AWS (1), Azure (2), GCP (1), Kubernetes (2), Keycloak (1),
Elastic (1), LocalGit (13), PPTX (2), Yagmail (1), and Zephyr Squad (15).
Their authority source and admission policy must be explicit before live porting.

The SDK also defines `EmbeddingConfiguration`, but it is not one of the 32
registered configuration families. Rust will model it as a referenced model
contract rather than silently registering a 33rd family.

### GitHub reference-family foundation

GitHub is the first concrete family and fixes the ownership convention without
claiming the full 44-tool SDK catalog. Main still freezes the selected toolkit
and configuration identity in
`internal/application/agentexecution/tools.go`. During claim-scoped input
materialization,
`internal/infra/storage/configurations_materializer.go::materializeAgentExecution`
resolves the frozen configuration settings and unsecrets the nested owned
configuration into the bounded input document. The future authorized Rust
assembler will parse that sealed materialized shape only after
`AUTHORIZED_NOW`; it will not perform another configuration lookup or persist a
second plaintext copy.

`src/toolkits/families/github/config.rs` validates the current nested
`github_configuration` shape, GitHub Enterprise API base, repository, branch
and selected-tool bounds. It preserves the SDK authentication precedence:
access token, username/password, GitHub App, then anonymous. Secret strings are
non-`Clone`, non-`Debug` and zeroized on ordinary drop. The decoded GitHub App
key/JWT buffers are also zeroized; `ring` does not guarantee erasure of its
internal RSA key schedule, so complete key-schedule erasure remains a worker
process-isolation and termination property rather than an overclaimed local
guarantee.

`src/toolkits/families/github/client.rs` creates one bounded `reqwest::Client`
per materialized toolkit invocation. Its pool is reused by that toolkit's
calls, never stored in a process-global credential registry. HTTPS-only
requests are origin-bound to the frozen API base, redirects are disabled,
timeouts and response bodies are capped, and diagnostics retain no URL,
repository, credential or upstream body. GitHub primary/secondary rate-limit
`403` responses remain retryable and distinct from ordinary authorization
failures. The probe matches the current SDK behavior: anonymous is a
validation-only success, token/basic call `/user`, and App JWT calls `/app`.
App-backed tool execution is still rejected because an installation-token
exchange has not been implemented.

`src/toolkits/families/github/tools.rs` exposes five explicitly selected
ordinary reads through ADK-Rust 2.0.0's native `Tool`/`BasicToolset` boundary
and the shared immutable blocklist. Empty selection still means all 44 SDK
tools, so the partial Rust family rejects it instead of silently shrinking
functionality. The current tests prove auth precedence and malformed pairs,
Enterprise/repository normalization and bounds, origin/header binding, PKCS8
App JWT shape, bounded response projection, rate-limit classification, native
ADK selection/policy/argument behavior, exact line slicing/large-file guidance,
cumulative batch admission and bounded regex search.

The first file group follows this source-to-Rust chain:

| Current business source | Preserved behavior | Rust owner / deliberate hardening |
| --- | --- | --- |
| Main `internal/application/agentexecution/tools.go` and `internal/infra/storage/configurations_materializer.go::materializeAgentExecution` | Freeze the selected toolkit and resolve the exact repository, branch and owned configuration into the admitted request | `config.rs` consumes only that sealed materialized shape; it performs no configuration lookup and creates no second credential authority |
| Python worker `agents/sdk_adapter.py::EliteaSdkAgentAdapter::{execute_application,execute_adhoc}` | Both agent kinds enter the same pinned SDK application/toolkit runtime | The future authorized Rust assembler will select this same family for both kinds; the capability remains disabled until that composition and the full selected catalog are available |
| SDK `tools/github/github_client.py::{_read_file,read_file,read_multiple_files}` | GitHub Contents API, active-branch default, optional repository for a single read, 1-indexed inclusive line slicing, structured 200,000-character guidance, and cumulative batch skipping without fetching later files | `client.rs::GitHubApi::read_text_file` plus `tools.rs` preserve those results. Paths, UTF-8/base64 content, file bytes, batch count and output are bounded. Rust intentionally performs one asynchronous transport attempt; the lifecycle owns retry rather than copying the SDK's blocking `time.sleep` retry loop |
| SDK `tools/elitea_base.py::BaseToolApiWrapper::search_file` and `tools/utils/text_operations.py::{apply_line_slice,search_in_content}` | `grep_file` is case-insensitive, supports regex or literal input, reports one match per line with before/after context, and uses Python-compatible line boundaries | `tools.rs` uses the non-backtracking Rust `regex` engine with explicit pattern/program/context/match/output limits. Invalid regex is a stable invalid-input error before network use instead of the SDK's warning plus ambiguous no-match result |
| SDK `tools/utils/file_metadata.py::{guard_text_read,capped_read_multiple_files}` and `runtime/langchain/constants.py::DEFAULT_MAX_OUTPUT_CHARS` | Plain content below the cap; schema `1.0` `content_too_large` guidance above it; line-range honesty for an unchunkable single line; one cumulative 200,000-character batch budget | Rust emits the same machine discriminator, line instructions and skip notice. Per-file batch failures are data-free so upstream exception bodies, private repositories and credentials cannot enter model context or logs |

The GitHub REST projection accepts only a `type=file`, exact base64-declared
size and valid UTF-8 payload. Directories, symlinks, submodules, malformed
encoding, binary content and responses above the one-MiB decoded ceiling fail
closed. Repository and file arguments are encoded as URL path segments after
rejecting absolute paths, empty segments and `.`/`..`; they cannot replace the
admitted API origin.

Connection checking remains a Main API responsibility. Main owns caller and
project authorization, configuration/revision selection, request bounds,
audit, and the public single/batch response contract. Its current
`internal/api/v2/configurations/handler.go::{CheckConnection,BatchCheckConnections}`
handlers return unconditional success, whereas Python worker
`agents/sdk_adapter.py::EliteaSdkConfigurationAdapter.check_connection`, legacy
indexer worker `methods/indexer_check_connection.py`, and SDK
`configurations/github.py::GithubConfiguration.check_connection` perform the
real family probe. The target Main composition dispatches a typed bounded
validation operation to the same Rust GitHub client rather than adding a second
Go GitHub implementation. If a family later remains entirely inside a
Main-owned connector with the same credential and egress boundary, Main may
keep its probe there; the invariant is one family client per execution plane,
not one prescribed language.

Production registration remains disabled. Before this family can execute live
agent work it still needs the authorized materializer connection, platform
egress/private-DNS and Enterprise-CA policy, real GitHub TLS component proof,
GitHub App installation-token support, the remaining 39 SDK operations
(including six indexing-only operations), and direct sensitive-tool/HITL
fencing.

## Special runtime toolsets

| Python source | Behavior | Rust target | Status / deviation |
| --- | --- | --- | --- |
| SDK `runtime/toolkits/mcp.py` | Remote MCP discovery and invocation | `src/toolkits/mcp.rs`, `src/adk/mcp.rs` | Planned; use ADK remote MCP primitives |
| SDK `runtime/toolkits/mcp_config.py` | Saved HTTP/stdio MCP definitions | MCP module plus external MCP runner client | Planned; stdio intentionally externalized |
| SDK `runtime/toolkits/application.py` | Nested applications | `src/agents/application_tools.rs` | Planned; agent-runtime slice |
| SDK `runtime/toolkits/artifact.py` | 16 artifact tools and indexing coupling | `src/toolkits/artifact.rs` | Planned; artifact service boundary required |
| SDK `tools/memory` and `runtime/toolkits/vectorstore.py` | Four memory and four vectorstore tools | `src/toolkits/{memory,vectorstore}.rs` | Planned |
| SDK `runtime/tools/sandbox.py` | Two Pyodide variants | External sandbox client | Intentional deviation: library abstraction is not a sandbox |
| SDK `runtime/tools/data_analysis.py` | Generated data analysis over artifacts | External sandbox/artifact boundary | Planned after isolation design |
| SDK `community/inventory` | Dynamic retrieval/ingestion registry | `src/toolkits/inventory.rs` | Planned; current 14-schema versus 9-default drift must be resolved |

## Safe implementation ownership

Parallel family work starts only after the shared schema, HTTP, credential,
policy, invocation-event, cancellation and ADK `Toolset` kernel is frozen.
Non-overlapping batches are:

1. GitHub completion as the first full reference family.
2. Independent simple REST families.
3. GitLab plus GitLab Org, Bitbucket and LocalGit with separate owners.
4. All four ADO toolsets under one owner.
5. Jira and Confluence after one shared Atlassian normalizer.
6. qTest, TestRail, Xray and all Zephyr variants as coherent test-management
   batches.
7. OpenAPI before Postman.
8. Cloud/data toolsets only after explicit allowlists replace unrestricted
   generic execution.
9. SharePoint, Figma and PPTX as content-heavy independent batches.
10. Special runtime toolsets as architecture work, not ordinary family ports.
11. Shared indexing overlay last.

## Shared executable boundary

`src/toolkits/invocation.rs` deliberately wraps ADK-Rust 2.0.0's native
`Tool` and returns its native `BasicToolset`; it is not a replacement toolkit
framework. The wrapper freezes bounded model-visible action metadata, applies
the immutable deployment blocklist to each concrete action, validates bounded
object arguments, preserves the SDK's removal of top-level null optionals, and
redacts delegated failures while retaining stable categories and retry hints.
It owns no background task and performs no retry. Externally visible effects
still require a family-specific effect identity or idempotency boundary because
dropping a future cannot prove a remote effect did not happen. Expected,
model-actionable business failures remain bounded structured tool results;
`AdkError` is reserved for redacted infrastructure and control failures.

The SDK toolkit families are still product functionality and will be ported,
not replaced by configuration descriptors. Main retains the public
`check_connection` routes, project authorization, configuration revision and
audit/result contract. The target route delegates its actual bounded probe to
the same family client used for execution instead of duplicating every vendor
client in Go; the GitHub section above is the first concrete example.

Each Rust family owns configuration parsing needed by its client, claim-scoped
materialization, the actual probe operation when delegated, and its concrete
ADK tools. The first full family is the reference implementation before
independent families are split into separate work. Sensitive-tool confirmation,
MCP smart authorization, nested applications, code execution and indexing
overlays remain separate capabilities because their durable authority and
isolation rules differ from an ordinary function call.
