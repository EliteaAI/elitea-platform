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

Model-facing tool metadata is part of the functional contract for every
family. A complete port must give each tool a concise selection description
that distinguishes its operation and side effect, and give every argument its
meaning, required format, defaults, bounds and useful examples. Rust may
clarify or shorten weak source prose rather than copy it byte-for-byte, but it
must preserve the source operation and result meaning. Focused family tests
inspect names, descriptions and parameter schemas so selection quality cannot
silently regress or force avoidable model retries and token use.

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
`a87561d7a051e13716739764eb62299a253e10ba`, SDK commit
`9bba9da409771803f28c0ee21f5d0b9a8f456219`, and legacy indexer-worker commit
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

This is a static deny policy, not sensitive-action authorization. The SDK's
`read`/`write`/`search`/`index` grouping describes an operation; it does not
exempt a tool from deployment sensitivity. Trusted environment configuration
may mark any concrete tool, including a read used for testing, as sensitive.
Sensitive tools, MCP smart auth and direct HITL therefore retain a shared
durable invocation identity and `interrupt_id` state machine independent of
family metadata. An approval for identical arguments is never authority for a
later function call.

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
| `github` | `configurations/github.py::GithubConfiguration` | `tools/github::EliteAGitHubToolkit` | 44 | Yes | `toolkits/families/github/{config,client,code_search,commits,projects,pull_requests,workflow_runs,tools}.rs`; future public descriptor | Capability-disabled foundation: strict anonymous/PAT/basic/App probe parsing plus twenty explicit identity, branch, file, repository-navigation, issue, pull-request, commit, server-side code-search, workflow-status and Project V2 reads; the other 24 tools, workflow-log archives, App installation auth, sensitive effects, indexing overlay and live composition remain gates |
| `ado` | `configurations/ado.py::AdoConfiguration` | `tools/ado` dispatcher; repos, plans, boards, wiki toolkits | 74 | Yes | `configurations/families/ado.rs`; `toolkits/families/ado/` | Planned; one owner for shared auth/client and aliases |
| `gitlab` | `configurations/gitlab.py::GitlabConfiguration` | `EliteAGitlabToolkit`, GitLab Org toolkit | 44 | Yes | `configurations/families/gitlab.rs`; `toolkits/families/gitlab/` | Planned; standard and org stay together |
| `qtest` | `configurations/qtest.py::QtestConfiguration` | `tools/qtest::QtestToolkit` | 25 | Yes | `configurations/families/qtest.rs`; `toolkits/families/qtest/` | Planned |
| `bitbucket` | `configurations/bitbucket.py::BitbucketConfiguration` | `tools/bitbucket::EliteABitbucketToolkit` | 22 | Yes | `configurations/families/bitbucket.rs`; `toolkits/families/bitbucket/` | Planned |
| `confluence` | `configurations/confluence.py::ConfluenceConfiguration` | `tools/confluence::ConfluenceToolkit` | 25 | Yes | `configurations/families/confluence.rs`; `toolkits/families/confluence/` | Planned; shared Atlassian auth normalizer |
| `jira` | `configurations/jira.py::JiraConfiguration` | `tools/jira::JiraToolkit` | 23 | Yes | `configurations/families/jira.rs`; `toolkits/families/jira/` | Planned; shared Atlassian auth normalizer |
| `postman` | `configurations/postman.py::PostmanConfiguration` | `tools/postman::PostmanToolkit` | 31 | No | `configurations/families/postman.rs`; `toolkits/families/postman/` | Planned |
| `service_now` | `configurations/service_now.py::ServiceNowConfiguration` | `tools/servicenow::ServiceNowToolkit` | 3 | No | `toolkits/families/service_now/{config,client,tools}.rs` | Capability-disabled complete family: one bounded incident read plus create and update effects over fixed-origin Table API; shared durable sensitive-tool approval, authorized materialization and cancellation-safe effect reconciliation remain gates |
| `testrail` | `configurations/testrail.py::TestRailConfiguration` | `tools/testrail::TestrailToolkit` | 23 | Yes | `configurations/families/testrail.rs`; `toolkits/families/testrail/` | Planned |
| `slack` | `configurations/slack.py::SlackConfiguration` | `tools/slack::SlackToolkit` | 7 | No | `configurations/families/slack.rs`; `toolkits/families/slack/` | Planned |
| `azure_search` | `configurations/azure_search.py::AzureSearchConfiguration` | `tools/azure_ai/search::AzureSearchToolkit` | 2 | No | `toolkits/families/azure_search/{config,client,tools}.rs` | Capability-disabled complete read family: fixed configured index, two bounded reads, SDK 11.5.2 wire/result projection and no unbounded continuation; authorized materialization and live provider proof remain gates |
| `delta_lake` | `configurations/delta_lake.py::DeltaLakeConfiguration` | `tools/aws/delta_lake::DeltaLakeToolkit` | 3 | No | `configurations/families/delta_lake.rs`; `toolkits/families/delta_lake/` | Planned; source has no focused family tests |
| `bigquery` | `configurations/bigquery.py::BigQueryConfiguration` | `tools/google/bigquery::BigQueryToolkit` | 11 | No | `configurations/families/bigquery.rs`; `toolkits/families/bigquery/` | Planned; source has no focused family tests |
| `xray` | `configurations/xray.py::XrayConfiguration` | `tools/xray::XrayToolkit` as `xray_cloud` | 12 | Yes | `configurations/families/xray.rs`; `toolkits/families/xray/` | Planned; preserve runtime alias |
| `zephyr` | `configurations/zephyr.py::ZephyrConfiguration` | Zephyr and Zephyr Scale | 30 | No | `configurations/families/zephyr.rs`; `toolkits/families/zephyr/` | Planned; all Zephyr variants one batch |
| `zephyr_enterprise` | `ZephyrEnterpriseConfiguration` | `ZephyrEnterpriseToolkit` | 11 | Yes | corresponding family paths | Planned; source has no focused family tests |
| `zephyr_essential` | `ZephyrEssentialConfiguration` | `ZephyrEssentialToolkit` | 51 | Yes | corresponding family paths | Planned; largest fixed catalog, no focused tests |
| `figma` | `configurations/figma.py::FigmaConfiguration` | `tools/figma::FigmaToolkit` | 17 | Yes | corresponding family paths | Planned; content/artifact limits required |
| `rally` | `configurations/rally.py::RallyConfiguration` | `tools/rally::RallyToolkit` | 8 | No | corresponding family paths | Planned; source has no focused family tests |
| `sonar` | `configurations/sonar.py::SonarConfiguration` | `tools/code/sonar::SonarToolkit` | 1 | No | `toolkits/families/sonar/{config,client,tools}.rs` | Capability-disabled complete read family: one project-bound `/api/issues/search` request with bounded filters and raw JSON projection; authorized materialization and live Sonar TLS proof remain gates |
| `sql` | `configurations/sql.py::SqlConfiguration` | `tools/sql::SQLToolkit` | 2 | No | corresponding family paths | Planned; dialect/driver and query policy required |
| `google_places` | `configurations/google_places.py::GooglePlacesConfiguration` | `tools/google_places::GooglePlacesToolkit` | 2 | No | `toolkits/families/google_places/{config,client,tools}.rs` | Capability-disabled complete read family: supported Places API (New) projection for `places` and `find_near`; attribution/persisted-result policy, authorized materialization and live provider proof remain gates |
| `salesforce` | `configurations/salesforce.py::SalesforceConfiguration` | `tools/salesforce::SalesforceToolkit` | 6 | No | `toolkits/families/salesforce/{config,client,tools}.rs` | Capability-disabled complete family: six bounded CRM tools, including create/update and generic GET/POST/PATCH/DELETE; authorized materialization, exact-interrupt HITL and cancellation-safe effect reconciliation remain gates |
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

`src/toolkits/families/github/tools.rs` exposes twenty explicitly selected
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
| SDK `tools/github/github_client.py::{_get_files,list_files_in_main_branch,list_files_in_bot_branch,get_files_from_directory}` | Resolve the configured base or active ref, fetch one recursive Git tree, retain only blobs, and optionally filter one directory prefix | `client.rs::GitHubApi::list_repository_files` preserves the base/active scopes and recursive path results. It bounds the tree body, entry/path/file counts and serialized output. GitHub's `truncated=true` is a resource error instead of the SDK's warning plus a silently incomplete list |
| SDK `tools/github/github_client.py::{get_issues,get_issue,validate_search_query,search_issues}` plus `schemas.py::{NoInput,GetIssue,SearchIssues}` | `get_issues` is exposed as configured-repository/open-only despite a wider Python signature; detail and search permit an optional repository; search prepends `repo:`, distinguishes issues from pull requests and returns the current empty-result message | `client.rs::GitHubApi::{list_open_issues,get_issue,search_issues}` and `tools.rs` preserve those callable schemas, projected field names and Python `datetime.isoformat()` timestamp form. Rust keeps one bounded page of at most 100 results, caps response/body/metadata/serialized output, rejects the SDK's dangerous-query patterns before transport and omits unknown upstream fields and error bodies |
| SDK `tools/github/github_client.py::{list_open_pull_requests,get_pull_request,list_pull_request_diffs}` plus `schemas.py::{ListPullRequestsInput,GetPR}` | Configured-repository open-listing; optional repository for one PR; PR metadata, issue comments, commit messages and changed-file patch fragments | `client.rs::GitHubApi::{list_open_pull_requests,get_pull_request,list_pull_request_files}`, `pull_requests.rs` and `tools.rs` preserve names, callable scopes and success field meanings. Rust deliberately replaces double-stringified comments/commits and token-budget-dependent missing fields with complete bounded typed arrays, preserves null bodies/users, normalizes timestamps like Python, caps detail items at ten, caps changed files at 300 and verifies the PR's declared `changed_files` before bounded local pagination. GitHub patch fragments remain fragments and null remains null; no tool claims full file contents |
| SDK `tools/github/github_client.py::{get_commits,get_commit_changes,get_commits_diff}` plus `schemas.py::{GetCommits,GetCommitChanges,GetCommitsDiff}` | List commits with optional repository/ref/path/time/author filters; inspect one commit's totals and changed-file fragments; compare two general commit, branch or tag refs | `client.rs::GitHubApi::{list_commits,get_commit_changes,compare_commits}`, `commits.rs` and `tools.rs` preserve the public names, default count, success field names, renamed-file metadata and Python timestamp form. Rust canonicalizes date-only and offset timestamps to UTC before transport, safely projects missing authors as `Unknown`/null, caps list and compare commits at 100, commit files at 300, compare files below GitHub's ambiguous 300-file ceiling, patch fragments at 64 KiB and total output at 200,000 characters. It pages one commit until complete and rejects mismatched SHAs or overflow instead of silently returning a partial change set. Empty identical/behind comparisons derive the head only from the same compare snapshot (`base_commit`/`merge_base_commit`), so a mutable ref cannot be substituted by a later fallback request |
| SDK `tools/github/github_client.py::search_code` plus `schemas.py::SearchCode` and PyGithub 2.3.0 `Github.search_code` | Blank-query rejection; configured-repository auto-scope unless an explicit `repo:`, `org:` or `user:` scope exists; optional indexed sort/order and caller-visible page metadata; file/repository/text-match success fields | `client.rs::GitHubApi::search_code`, `code_search.rs` and `tools.rs` preserve the public schema and explicit-scope behavior. Rust sends `page`/`per_page` in one direct `/search/code` request instead of walking and discarding lazy PyGithub pages, reports GitHub's actual `incomplete_results`, omits unknown provider fields, and never performs a per-result content request merely to discover absent text matches. Query, first-1,000 search window, page size, response, item/fragment/match collections and 200,000-character output are bounded; enums and 422 responses become stable invalid-input failures, and query/repository/upstream bodies are not logged or rendered |
| SDK `tools/github/github_client.py::get_workflow_status` plus `schemas.py::GetWorkflowStatus` and PyGithub 2.3.0 `Repository.get_workflow_run`/`WorkflowRun.jobs` | Decimal string run ID, optional repository override, run identity/status/ref/timestamp metadata and job identity/status/timestamps | `client.rs::GitHubApi::get_workflow_status`, `workflow_runs.rs` and `tools.rs` preserve the callable schema and success fields through one run request plus one explicit jobs request. Rust validates the run ID before transport, verifies every returned job belongs to that run, preserves provider-nullable status/name/URL fields, caps each response and serialized output, normalizes timestamps, omits steps/unknown provider fields and returns at most 100 jobs together with `jobs_total_count` and `jobs_truncated`; this makes the deliberate bound visible instead of materializing the SDK's unbounded lazy iterator. Workflow log ZIP retrieval is a separate gate because archive, entry, path and decompressed-byte limits must be enforced together |
| SDK `tools/github/graphql_client_wrapper.py::{list_project_issues,_list_project_issues_internal,_process_project_fields,_process_project_items}`, `tool_prompts.py::GraphQLTemplates` and `schemas.py::ListProjectIssues` | Select a repository Project V2 by number and return its identity, fields, single-select options, bounded item content, labels, assignees and text/date/single-select values | `client.rs::GitHubApi::list_project_issues`, `projects.rs` and `tools.rs` preserve the callable schema and projected success fields. Rust deliberately replaces the SDK's structure request plus mutable pagination loop with one fixed GraphQL query for at most 100 items, requests the option color that the Python projector exposes but its query omits, adds `items_total_count`/`items_truncated`, caps every nested collection, response and serialized output, and rejects partial GraphQL data whenever `errors` is nonempty. The endpoint is derived from the admitted REST base as GitHub documents: `/graphql` for a root API base and `/api/graphql` for an Enterprise `/api/v3` base; the pinned SDK's unconditional `requester.base_url + "/graphql"` is not copied. `search_project_issues` remains gated because the pinned GraphQL query declares but never uses `search_query`; Rust will not advertise an unfiltered list as search |

The GitHub REST projection accepts only a `type=file`, exact base64-declared
size and valid UTF-8 payload. Directories, symlinks, submodules, malformed
encoding, binary content and responses above the one-MiB decoded ceiling fail
closed. Repository and file arguments are encoded as URL path segments after
rejecting absolute paths, empty segments and `.`/`..`; they cannot replace the
admitted API origin. Repository navigation first resolves the configured branch
(falling back to the commit endpoint for a SHA, tag or other ref like the SDK), then accepts only a complete
bounded recursive Git tree. Main/active whole-tree tools take no arguments, as
their current SDK schemas require; directory listing is active-branch scoped.
The GraphQL path shares the same invocation-scoped pool, immutable credentials,
origin and timeout policy, but uses a fixed POST body and a separately derived
GitHub-documented endpoint. Provider error messages and partial data are never
returned to the model or retained in diagnostics.

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
GitHub App installation-token support, the remaining 24 SDK operations
(including six indexing-only operations), and direct sensitive-tool/HITL
fencing.

### Google Places complete read family

Google Places is the first complete fixed-tool family after the GitHub
reference kernel. The current source baseline is SDK
`9bba9da409771803f28c0ee21f5d0b9a8f456219`, Python worker's pinned SDK
`b5113a129329b85d23c2d5c2bf55f18e307414ec`, and legacy indexer worker
`62656d2b3bd51ded513693a1bd9b2f3a303ce09c`. Main freezes `results_count`,
the selected tools and the owned Google Places configuration through
`internal/application/agentexecution/tools.go`, then
`internal/infra/storage/configurations_materializer.go` resolves the nested
`api_key` into the claim-scoped input. Application and ad-hoc execution both
carry that same snapshot through
`elitea_worker/agents/sdk_adapter.py::EliteaSdkAgentAdapter`; Rust therefore
uses one family and does not fork the business lifecycle by agent kind.

The SDK source is
`elitea_sdk/tools/google_places/{__init__,api_wrapper}.py` with
`googlemaps==4.10.0`. It exposes exactly two read tools: `places(query)` and
`find_near(current_location_query,target,radius=3000)`. Empty selection means
both. The Python implementation uses legacy Text Search, per-place Details,
Geocoding and Nearby Search endpoints. Its `places` list comprehension calls
Details twice for every successful result, so one page can cause 41 requests;
its validator also stores the client in class-shared state, allowing one
wrapper's key to replace another's. Those are implementation defects, not
business contracts, and are not reproduced.

`src/toolkits/families/google_places/config.rs` accepts only the
claim-materialized nested credential, zeroizes the invocation-scoped key, and
keeps secret-bearing values non-`Clone` and non-`Debug`. Null or zero
`results_count` means the provider first-page maximum of 20, positive larger
values clamp to 20 like the current first-page behavior, and negative or
malformed values fail before client creation. `tools.rs` exposes both native
ADK-Rust read-only tools through the shared materialization policy. It makes
`target` truthfully required: the SDK schema calls it nullable, but its null
normalization removes the positional argument and the implementation then
fails before a provider call. Radius null still becomes 3,000 meters and the
admitted range is Google's documented 1 through 50,000 meters.

`client.rs` intentionally projects the same user-visible operation over the
supported Places API (New), rather than copying a legacy wire API that Google
has frozen. `places` performs one
`POST https://places.googleapis.com/v1/places:searchText` with a fixed field
mask and sensitive API-key header, returns the current numbered name/address/
place-ID/phone/website text, and preserves the exact no-result message.
`find_near` performs one bounded Geocoding request and one location-biased Text
Search New request because Nearby Search New does not accept the SDK's free
text target. It returns bounded typed JSON instead of Python's unstable list
`repr`. Both paths use one invocation-scoped pooled HTTPS-only client, disable
redirects, cap request/response/result sizes, perform one asynchronous attempt,
and retain no query, location, key, URL or provider body in errors. Main and the
authorized lifecycle remain the retry and deadline owners.

| Current business source | Preserved behavior | Rust owner / deliberate hardening |
| --- | --- | --- |
| Main `internal/application/agentexecution/tools.go` and `internal/infra/storage/configurations_materializer.go` | Freeze the selected family and claim-materialize its owned API key for application and ad-hoc execution | `config.rs` parses only that sealed shape; no environment fallback, lookup, global client or second credential authority |
| Python worker `agents/sdk_adapter.py::EliteaSdkAgentAdapter::{execute_application,execute_adhoc}` | Both agent kinds delegate the same selected toolkit snapshot to the SDK | Future authorized Rust assembly selects this same native family for both kinds; current capability registration stays empty |
| SDK `tools/google_places/api_wrapper.py::{places,fetch_place_details,format_place_details}` | Text query, first-page result count, numbered visible fields and no-result message | `client.rs::GooglePlacesApi::places` uses one Places New request with a fixed field mask; it removes duplicate detail fan-out and class-shared credentials while preserving the callable result |
| SDK `tools/google_places/api_wrapper.py::find_near` | Geocode a starting location, search a target with a radius bias, return the first bounded provider page | `client.rs::GooglePlacesApi::find_near` uses Geocoding plus location-biased Text Search New, validates target/radius before transport and returns stable typed JSON; neither the legacy nor new API promises strict containment |
| SDK `tools/google_places/__init__.py::GooglePlacesToolkit` and `tools/base/tool.py::BaseAction` | Empty/subset selected-tool semantics, top-level null normalization and read grouping | `tools.rs` plus the shared invocation/policy kernel expose exactly `places` and `find_near`, default null radius to 3,000, and reject the misleading missing/null target before provider use |

The current configuration catalog declares no Google Places connection check,
so Rust does not invent one. Main retains the public check-connection/auth/
revision/audit boundary. Production registration additionally waits for an
authorized toolkit assembler, restricted billing-key component proof, and a
product/legal decision on Google Maps attribution and persistence/caching of
Places content in tool results and checkpoints. A passing capability-disabled
unit suite is not that policy approval. The tools are safe to call concurrently,
but the future authorized assembler must still apply the invocation-wide
bounded ADK tool-concurrency policy; reqwest's idle-pool setting is not an
execution-concurrency limit.

### Sonar complete read family

Sonar is a complete one-tool read family, not a generic REST proxy. Evidence was
refreshed on 2026-08-18 against SDK
`9bba9da409771803f28c0ee21f5d0b9a8f456219`, Python worker's pinned SDK
`b5113a129329b85d23c2d5c2bf55f18e307414ec`, legacy indexer worker
`62656d2b3bd51ded513693a1bd9b2f3a303ce09c`, and the Rust-branch Main/Python
source at `557c3c7fd23eed5f0b8d2d1679f7d3367e1a6981`. The only SDK change between
the worker pin and current catalog is the `read` group annotation; the
configuration, tool schema, request, output and failure behavior are otherwise
unchanged.

Main
`internal/application/agentexecution/tools.go::CurrentApplicationToolSnapshotService.FreezeCurrentApplicationVersion`
freezes the selected tool, Sonar project and nested configuration.
`internal/infra/storage/configurations_materializer.go::{materializeAgentExecution,materializeCurrentAgentTools}`
redeems the token into the claimed input, and Python worker
`agents/sdk_adapter.py::EliteaSdkAgentAdapter::{execute_application,execute_adhoc}`
carries the same immutable snapshot for both agent kinds. Rust therefore has
one invocation-scoped family owner; the model never chooses the origin,
credential or project.

The current SDK sources are
`elitea_sdk/configurations/sonar.py::SonarConfiguration`,
`elitea_sdk/tools/code/sonar/__init__.py::SonarToolkit` and
`elitea_sdk/tools/code/sonar/api_wrapper.py::SonarApiWrapper`. Empty selection
means the sole `get_sonar_data(relative_url,params=null)` read tool. The wrapper
parses a JSON query object, overwrites `componentKeys` with the configured
project, performs one Basic-token GET and returns decoded provider JSON. The
callable annotation says `str`, but the actual successful value is an object.
That object result is the business contract.

The Python implementation also stores its `requests.Session` in class state,
so constructing a second wrapper replaces the first wrapper's credential. It
has no timeout, follows redirects, accepts path and query escape in
`relative_url`, accepts arbitrary valid JSON until a later `TypeError`, and
places a Python traceback in the invalid-JSON `ToolException`. Those are
implementation defects, not behavior to preserve.

`src/toolkits/families/sonar/config.rs` validates one HTTPS configured origin
with an optional trusted context path, rejects userinfo/query/fragment/encoded
path ambiguity, and owns a bounded zeroized non-`Clone`, non-`Debug` token.
`client.rs` appends the fixed `/api/issues/search` endpoint, disables redirects,
uses a sensitive Basic `token:` header and one invocation-scoped connection
pool, and performs one asynchronous request. The public argument remains for
schema compatibility but accepts only exact `/api/issues/search`.

The query parser accepts a bounded JSON object and a versioned allowlist of
public issue-search filters. It rejects nested values, unknown parameters and
every alternate project/component scope; caller `componentKeys` is discarded
and the claim-materialized project is injected exactly once. `p` and `ps` are
positive integers no greater than 100 with a 10,000-item window, missing `ps`
becomes 100, and array/scalar/query/body/decoded-issue/serialized-output limits
are explicit. The bounded successful JSON object is returned without inventing
or silently truncating provider fields. Errors retain only a stable code and
retryability; token, origin, project, filters, provider text and body never
enter diagnostics.

| Current business source | Preserved behavior | Rust owner / deliberate hardening |
| --- | --- | --- |
| Main tool freezer and configuration materializer | Freeze exact selected tool/project/revision and redeem the owned token only inside a claimed execution | `config.rs` consumes only the materialized nested shape; no environment fallback, lookup, global client or second credential authority |
| Python worker `EliteaSdkAgentAdapter::{execute_application,execute_adhoc}` | Both kinds use the same frozen standard-toolkit dispatch | Future authorized Rust assembly selects this same family for both; capability registration remains empty |
| SDK `SonarApiWrapper::parse_payload_params` | Missing/null/empty params mean no caller filters; valid JSON supplies issue filters | `client.rs` accepts an object only, bounds its complete encoded form and emits stable `InvalidInput`/`ResourceExhausted` errors without traceback |
| SDK `SonarApiWrapper::get_sonar_data` | One issue-search request, configured project overrides caller scope, decoded JSON returned unchanged | `SonarApi::get_sonar_data` keeps one GET and raw bounded object result while fixing endpoint/origin escape, redirect, timeout and class-shared credential defects |
| SDK `SonarToolkit` and shared `BaseAction` | Empty/subset selection, nullable `params`, read grouping and toolkit-name description | `tools.rs` plus the shared invocation/policy kernel expose exactly `get_sonar_data`, truthfully constrain its schema and reapply the immutable blocklist |

Neither current `SonarConfiguration` nor `SonarToolkit` implements a
connection check. Legacy
`methods/indexer_check_connection.py::indexer_configuration_check_connection`
returns `Check connection is not implemented yet for sonar`, and the static
catalog declares `check_connection_supported=false`. Rust therefore does not
invent a public check. Main retains public authorization, revision, audit and
connection-status ownership; its future route may delegate a real bounded probe
to this same family client if the product contract adds one.

Production registration remains disabled until the authorized toolkit
materializer composes this owner into both agent kinds and a credentialed
component test proves deployment CA/private-DNS policy, Basic-token
compatibility, exact project isolation, redirects disabled, and Sonar's
documented `503` behavior while issue indexing is active. The future assembler
also owns the invocation-wide tool-concurrency ceiling; the HTTP idle-pool
setting is not an execution limit.

### Azure Search complete read family

Azure Search is a complete two-tool read family over one configured index. The
evidence baseline is current SDK
`9bba9da409771803f28c0ee21f5d0b9a8f456219` (`0.9.19`), Python worker's
pinned SDK `b5113a129329b85d23c2d5c2bf55f18e307414ec` (`0.9.8`), legacy
indexer worker `62656d2b3bd51ded513693a1bd9b2f3a303ce09c`, and
`azure-search-documents==11.5.2` with `azure-core==1.30.2`. The current SDK
only adds `read` group annotations to this family; its public schemas, request
construction and result projection otherwise match the worker pin. The lean
standalone Python worker image does not install `azure-search-documents`, so
the source contract is evidence, not proof that the current Python deployment
can execute this family.

Main freezes `index_name`, selected tools and the owned
`azure_search_configuration` through
`internal/application/agentexecution/tools.go`, then
`internal/infra/storage/configurations_materializer.go` resolves the endpoint
and API key into the claim-scoped input. Python worker
`agents/sdk_adapter.py::EliteaSdkAgentAdapter` carries the same snapshot for
application and ad-hoc execution. The model can choose search text, a bounded
result count, ordering, selected fields or a document key; it cannot replace
the endpoint, index, API key or API version.

SDK `elitea_sdk/tools/azure_ai/search/api_wrapper.py::AzureSearchApiWrapper`
registers exactly `text_search` and `get_document`; vector and hybrid helpers
are present but commented out of `get_available_tools`. Empty selection means
both in source order. `api_version`, `api_base`, `openai_api_key` and
`model_name` do not affect either registered read. The wrapper creates
`SearchClient` without an API version, so its exact wire uses stable
`2024-07-01`:

- `text_search` posts to
  `/indexes('{index}')/docs/search.post.search?api-version=2024-07-01` with
  `search`, optional `top`, comma-joined `orderby` and comma-joined `select`;
- `get_document` gets
  `/indexes('{index}')/docs('{key}')?api-version=2024-07-01` with optional
  `$select`;
- both send a sensitive `api-key` and
  `Accept: application/json;odata.metadata=none`.

The Python default `limit=-1` omits `top`, and `list(SearchItemPaged)` then
posts every provider continuation body to the same route without a total page,
item, byte or time limit. Empty field/order arrays also become empty strings due
to an unreachable normalization condition. Rust deliberately maps null or
`-1` to `top=100`, admits only `1..=100`, makes one bounded request and omits
empty arrays. It never follows `@odata.nextLink` or
`@search.nextPageParameters`. This is a visible resource-safety correction,
not claimed byte-for-byte behavior.

Search output remains a list of provider document objects. As in SDK
`_paging.py::convert_search_result`, every item contains
`@search.score`, `@search.reranker_score`, `@search.highlights` and
`@search.captions`, inserting null when absent; the underscore spelling of
`reranker_score` intentionally preserves Python's projection rather than the
REST `@search.rerankerScore` name. Document lookup returns the bounded provider
object unchanged.

`src/toolkits/families/azure_search/config.rs` parses only the materialized
HTTPS origin, provider-valid index name and zeroized non-`Clone`, non-`Debug`
key. `client.rs` owns one invocation-scoped pool, disables redirects and
automatic retries, fixes the API version and original origin/index, encodes
document keys, caps query lists/request/body/result/output, and retains no
endpoint, key, query or provider body in diagnostics. `tools.rs` publishes the
two native ADK tools in SDK order and preserves their `read` classification.
That classification is independent from environment-sensitive policy: the
shared direct-tool HITL adapter may still require an exact `interrupt_id`
approval for either read.

| Current business source | Preserved behavior | Rust owner / deliberate hardening |
| --- | --- | --- |
| Main tool freezer and configuration materializer | Freeze the exact index/tool selection and redeem the owned endpoint/key only inside one claimed execution | `config.rs` accepts the nested materialized shape and creates no environment fallback, global client or second credential authority |
| Python worker `EliteaSdkAgentAdapter::{execute_application,execute_adhoc}` | Both agent kinds delegate the same standard-toolkit snapshot | Future authorized assembly selects this same family for both kinds; capability registration remains empty |
| SDK `AzureSearchApiWrapper::{validate_fields,text_search}` plus Azure Search SDK 11.5.2 | One configured-index text search, optional order/projection and Python result metadata | `client.rs::AzureSearchApi::text_search` retains the wire/result meaning while bounding `-1`, order clauses, selected fields, response bytes and total items and refusing continuation fanout |
| SDK `AzureSearchApiWrapper::get_document` | Retrieve one key from the configured index with optional selected fields | `client.rs::AzureSearchApi::get_document` preserves the encoded key route and bounded provider dictionary |
| SDK `AzureSearchToolkit` and shared `BaseAction` | Empty/subset selection, top-level null normalization, descriptions and `read` grouping | `tools.rs` plus the shared invocation/policy kernel expose exactly the two registered tools and apply the immutable deployment policy |

Connection checking is contradictory upstream and is not reproduced. The
configuration class has no check, the static catalog truthfully says
`check_connection_supported=false`, and the legacy configuration path returns
unsupported. The toolkit schema separately attaches a broken method that reads
nonexistent top-level fields and probes Azure OpenAI deployments rather than
Azure Search. Current Go Main's generic route also returns unconditional
success and is not provider evidence. Rust exposes no check in this slice.

Production registration remains disabled until the authorized tool materializer
composes the family into both agent kinds and a credentialed component test
proves real TLS/private-endpoint policy, exact index isolation, bounds, error
redaction and configuration-driven sensitivity. A future truthful Search probe
may reuse this family client, but must not revive the Azure OpenAI check.

### ServiceNow complete incident family

The source baseline is current SDK
`9bba9da409771803f28c0ee21f5d0b9a8f456219`, worker-pinned SDK
`b5113a129329b85d23c2d5c2bf55f18e307414ec`, Python worker/Main
`1282fc7d2111a46d3e2e7ec15ecdc013e8b3c93e` and exact transport dependency
`pysnc==1.1.10`. The current-versus-pinned SDK diff only adds the
`read`/`write`/`write` group annotations; configuration, public argument
schemas, operations and results are otherwise unchanged.

Main freezes `{type, toolkit_name, settings}` through
`internal/application/agentexecution/tools.go` and claim-time
`internal/infra/storage/configurations_materializer.go` resolves the nested
`servicenow_configuration`. Python worker
`agents/sdk_adapter.py::EliteaSdkAgentAdapter` passes that same frozen snapshot
to both application and ad-hoc SDK entry points. Rust therefore accepts only
the claimed nested configuration and has no environment or secondary lookup
fallback.

SDK `tools/servicenow/api_wrapper.py::ServiceNowAPIWrapper` registers all three
incident operations in this exact order:

1. `get_incidents` (`read`) accepts an optional filter object;
2. `create_incident` (`write`) accepts an optional bounded JSON field object,
   including numeric or nested provider values and an intentional empty
   default incident;
3. `update_incident` (`write`) accepts a required `sys_id` and a JSON-object
   string of fields to update.

Empty selection means all three; a nonempty subset preserves source order.
Successful tools return the SDK-compatible JSON *string* containing an array
of raw-value incident records. With `sysparm_display_value=all`, `pysnc`
unwraps each `{value, display_value, link}` field to the non-null raw value and
falls back to `display_value` when the raw value is null; Rust preserves that
projection and discards the provider envelope.

`pysnc` uses Basic authentication and fixed Table API routes under
`/api/now/table/incident`. Every request carries
`sysparm_display_value=all`, `sysparm_exclude_reference_link=true` and
`sysparm_suppress_pagination_header=true`. List additionally sends the encoded
query, response fields, limit and offset zero. Create is one POST expecting
201. Update deliberately retains the source's GET-then-PATCH behavior so a
missing incident fails before mutation; PATCH expects 200. Neither effect is
retried by the family.

Rust fixes bounded defects without removing functionality:

- one materialized toolkit owns one non-`Clone`, non-`Debug`, zeroizing
  credential and HTTP pool; this removes the SDK validator's class-global
  endpoint/credential/field overwrite;
- HTTPS origin or a validated short instance is fixed before invocation;
  redirects, userinfo, query/fragment and argument-selected destinations are
  rejected;
- missing credentials fail during materialization instead of later client
  construction;
- null response fields use the SDK's ten-field defaults, and an empty string
  also uses those defaults rather than silently requesting every field;
- `number_of_entries` defaults to 100, is bounded to `1..=100`, controls only
  the first-page limit and is no longer accidentally emitted as a table
  column filter;
- filter keys are limited to the documented incident fields; encoded-query
  metacharacters, oversized values, invalid 32-character `sys_id`s, malformed
  update JSON and unbounded field sets fail before network use;
- request, streamed response, projected output, argument depth/node/string
  counts and deadlines are bounded; provider bodies, credentials, URLs,
  filters and update data never appear in diagnostics;
- reads expose transient retry hints but the client performs one attempt;
  create/PATCH transport and status ambiguity is never advertised retryable.
- `pysnc` silently drops an update field when it was absent from the configured
  GET projection. Rust deliberately sends every validated field requested by
  the caller, preventing a successful-looking update from losing data.

| Current business source | Preserved behavior | Rust owner / deliberate hardening |
| --- | --- | --- |
| Main freezer/materializer and Python shared SDK adapter | Claim-scoped nested configuration, selected tools and one application/ad-hoc family contract | `config.rs` parses the exact materialized authority and creates no process-global or environment authority |
| SDK `ServiceNowAPIWrapper::get_incidents` and `pysnc::GlideRecord.query` | Documented equality/description filters, default fields, one ordered first page and raw-value JSON-array string | `client.rs::ServiceNowApi::get_incidents` preserves the result meaning while fixing the accidental control filter and bounding query, fields, results and bytes |
| SDK `ServiceNowAPIWrapper::create_incident` | Create one incident, omit null fields, permit an empty body and return the created raw-value record | `client.rs::ServiceNowApi::create_incident` performs one non-retried POST with bounded body/result and stable ambiguity-safe errors |
| SDK `ServiceNowAPIWrapper::update_incident` | Read the exact incident first, omit null updates, patch once and return the updated raw-value record | `client.rs::ServiceNowApi::update_incident` validates the `sys_id` and bounded JSON object, then performs the same GET/PATCH fanout without write retry; unlike `pysnc`, it does not silently discard requested fields missing from the GET projection |
| SDK `ServiceNowToolkit` and shared `BaseAction` | Exact catalog order, empty/subset selection, top-level null normalization and operation groups | `tools.rs` plus the shared invocation/policy kernel expose all three tools; effects are not omitted |

Neither the configuration nor toolkit defines `check_connection`; current
catalogs truthfully report it unsupported. Rust does not invent a probe. A
future check can reuse the same origin-bound client only after Main defines a
truthful provider contract.

Production registration remains disabled, not functionally reduced. The read,
create and update implementations are all compiled and tested. Authorized
materialization, a credentialed ServiceNow component test and the shared
durable exact-`interrupt_id` guardrail remain activation gates. Before either
write is enabled, an owned cancellation-safe effect boundary must also retain
effect identity through provider completion and reconcile an ambiguous
POST/PATCH rather than settling cancellation as if no effect occurred. Group
metadata does not decide sensitivity: policy may require approval for the read,
either write, all three or none.

### Salesforce complete CRM family

The source baseline is current SDK
`9bba9da409771803f28c0ee21f5d0b9a8f456219`, worker-pinned SDK
`b5113a129329b85d23c2d5c2bf55f18e307414ec`, Python worker/Main
`1282fc7d2111a46d3e2e7ec15ecdc013e8b3c93e` and the worker's
`requests==2.34.0` transport contract. The current-versus-pinned SDK behavior
diff only adds `write`/`read`/`execute` group annotations. Both SDK versions
define the same configuration, callable arguments, lazy OAuth flow and result
shapes; neither contains focused Salesforce family tests.

Main freezes `{type, toolkit_name, settings}` in
`internal/application/agentexecution/tools.go` and claim-time
`internal/infra/storage/configurations_materializer.go` resolves the nested
`salesforce_configuration`. Python worker
`agents/sdk_adapter.py::EliteaSdkAgentAdapter::{execute_application,execute_adhoc}`
passes the same frozen tool snapshot into both SDK entry points. Rust accepts
only this materialized nested authority. It has no environment credential or
secondary configuration lookup.

SDK `tools/salesforce/api_wrapper.py::SalesforceApiWrapper` exposes the full
family in this order:

1. `create_case` (`write`) creates one Case from subject, description, origin
   and status;
2. `create_lead` (`write`) creates one Lead from last name, company, email and
   phone;
3. `search_salesforce` (`read`) runs one complete SOQL query; the required
   `object_type` remains a compatibility label and does not alter the query;
4. `update_case` (`write`) changes status and optionally a nonempty
   Description;
5. `update_lead` (`write`) changes nonempty Email and/or Phone;
6. `execute_generic_rq` (`execute`) calls a version-relative Salesforce REST
   resource using GET, POST, PATCH or DELETE.

Empty selection means all six and a subset retains this source order. The Rust
catalog does not hide effects. Each model-facing description distinguishes the
business operation, read/effect behavior, retry ambiguity and preferred
dedicated tool. Every argument schema states its required format, null/default
meaning, bound and useful example where one affects selection. This is a
deliberate clarity improvement over the SDK's one-line action labels: tool
selection quality and avoidable retry tokens are part of the functional
contract, while the operations and result meaning remain unchanged.

The client lazily POSTs the client-credentials form to
`/services/oauth2/token`, then binds all resource requests to the configured
HTTPS origin and `/services/data/{api_version}` root. Dedicated creates POST
the source field names, search encodes one `q` pair and returns the first page,
and updates PATCH a validated 15- or 18-character Salesforce record ID.
Generic GET maps its JSON-object string to scalar query pairs; generic
POST/PATCH/DELETE use it as a JSON body. A successful JSON response is returned
as the SDK-compatible object/array, while 204 update/generic success returns
the same `{success,message}` shape.

Rust preserves functionality while closing source defects and unbounded
behavior:

- one materialized toolkit owns one non-`Clone`, non-`Debug`, zeroizing client
  credential, lazy token and bounded HTTP pool;
- only an exact HTTPS origin and `v<digits>.<digits>` API version are admitted;
  redirects, userinfo, path/query/fragment authority and argument-selected
  origins are rejected;
- request, response, output, token, SOQL, generic path/query and recursive JSON
  sizes are bounded; diagnostics contain no token, credential, URL, query,
  payload or provider body;
- the client disables reqwest's implicit protocol retries. It refreshes and
  replays once only after an explicit provider 401, which proves rejection;
  transport loss, timeout, rate limit or 5xx after an effect dispatch is an
  `UnknownOutcome`, never automatic retry authority;
- search intentionally returns one page instead of following unbounded
  `nextRecordsUrl` fanout;
- Case Description keeps the SDK rule that omitted/empty means unchanged and
  cannot clear the field; Lead update rejects the SDK's no-op empty PATCH;
- generic method is the documented uppercase enum, GET uses query parameters,
  and a version-root-relative path cannot supply a scheme, authority, query,
  fragment, percent escape or traversal component.

| Current business source | Preserved behavior | Rust owner / deliberate hardening |
| --- | --- | --- |
| Main freezer/materializer and Python shared SDK adapter | Claim-scoped nested configuration, selected tools, stable toolkit name and one application/ad-hoc family contract | `config.rs` parses that exact authority and creates no global credential or lookup fallback |
| SDK `SalesforceApiWrapper::{authenticate,_headers,create_case,create_lead}` | Lazy client-credentials token plus dedicated Case/Lead POST field maps and raw JSON results | `client.rs::SalesforceApi::{create_case,create_lead}` preserves the calls and results through one bounded origin-bound client; effect ambiguity is typed and nonretryable |
| SDK `SalesforceApiWrapper::search_salesforce` | Required compatibility label, complete caller SOQL and first raw query page | `client.rs::SalesforceApi::search_salesforce` preserves the label/query contract, encodes one `q` pair and bounds the single returned page |
| SDK `SalesforceApiWrapper::{update_case,update_lead}` | PATCH one exact record, omit empty optional fields and return the 204 success object | Rust validates Salesforce IDs, retains the Case no-clear rule and rejects the source's empty Lead no-op before network use |
| SDK `SalesforceApiWrapper::execute_generic_rq` | Version-relative GET/POST/PATCH/DELETE escape hatch and JSON-string params | Rust retains all four methods while fixing lowercase/method ambiguity, GET query semantics and route confinement; DELETE is not omitted |
| SDK `SalesforceToolkit`, model classes and shared `BaseAction` | Exact source order, empty/subset selection, public arguments and operation groups | `tools.rs` plus the shared invocation/policy kernel expose all six native ADK tools with selection-oriented descriptions and immutable block filtering |

Neither Salesforce configuration nor toolkit defines `check_connection`; the
current catalogs report it unsupported and Rust does not invent a probe.
Client construction is offline and OAuth occurs only at real invocation. A
future explicit check can reuse the same bounded client after Main defines its
authorization and audit contract.

Production registration remains disabled, not functionally reduced. The read,
create, update and generic delete-capable implementations are compiled and
tested. Activation requires the authorized application/ad-hoc materializer, a
credentialed Salesforce component proof, and the shared durable
exact-`interrupt_id` guardrail. Operation group is not authorization: trusted
configuration may mark search, one write, the generic tool, all six or none as
sensitive. After effect dispatch, the owned invocation must retain effect
identity through provider completion or explicit unknown-outcome recovery;
dropping an ADK tool future must not settle cancellation as proof that a
create, PATCH or DELETE did not happen.

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

The shared schema, bounded HTTP, credential, policy, invocation-event,
cancellation and ADK `Toolset` kernel is now stable enough for independent
REST families; Google Places, Sonar and Azure Search are complete reads, while
ServiceNow and Salesforce prove the same boundary can retain bounded
create/update/delete effects without activating them ahead of durable approval.
These follow the partial GitHub reference family. Parallel family work still
must not share mutable files or weaken the capability gate.
Non-overlapping batches are:

1. GitHub completion as the broad reference family, including its gated effects.
2. Independent simple REST families using the Google Places/Sonar ownership pattern.
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
ADK tools. GitHub provides the broad reference and Google Places the first
complete fixed read family before independent families are split into separate
work. Sensitive-tool confirmation,
MCP smart authorization, nested applications, code execution and indexing
overlays remain separate capabilities because their durable authority and
isolation rules differ from an ordinary function call.
