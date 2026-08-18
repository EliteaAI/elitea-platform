# Configuration and toolset source mapping

The SDK snapshot registers 32 configuration families, 18 connection checks and
45 concrete standard toolkit classes with 619 fixed tool schemas. OpenAPI,
MCP, application and other runtime toolsets are dynamic. Rust will use immutable
configuration/toolset instances and one invocation kernel shared by direct
toolkit tests and ADK agent execution.

Target convention:

- configuration: `src/configurations/families/<family>.rs`
- toolset: `src/toolkits/families/<family>/{mod.rs,client.rs,tools.rs}`
- tests: `tests/configurations/<family>.rs` and
  `tests/toolkits/<family>_{catalog,materialization,invocation}.rs`

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
| SDK `runtime/toolkits/tools.py::get_tools` | Sanitize references, first-ID-wins deduplication, family dispatch, blocked-tool policy, MCP smart-auth and nested applications | `src/toolkits/{snapshot,materialize,policy}.rs` | Deduplication/classification implemented; materialization, policy, MCP and application execution remain capability-gated |

Evidence was refreshed against the platform/Python worker commit
`e69bb5b3ce5629ba95c3fd1ee50022e0b87cb65a`, SDK commit
`c0443b175adb8437e89826c17150330e32074faf`, and legacy indexer-worker commit
`b6c4ce83d997acbbbeb58fe040317a9e9352236f` on 2026-08-18. Later slices must
refresh these pins because all three Python sources continue to evolve.

## Shared kernel mapping

| Python source | Responsibility | Rust target | Proof | Status / deviation |
| --- | --- | --- | --- | --- |
| SDK `configurations/__init__.py` | Configuration registry and schemas | `src/configurations/registry.rs`, family modules | Registry/catalog golden and schema differential tests | Planned |
| SDK `tools/__init__.py::{toolkit_config_schema,get_tools}` | Toolkit registry, selected tools, dispatch, blocked tools and metadata | `src/toolkits/registry.rs`, `src/toolkits/materialize.rs` | Complete family/tool inventory and invalid-selection tests | Planned |
| SDK `runtime/toolkits/tools.py::get_tools` | Runtime toolsets before standard/community dispatch | `src/toolkits/materialize.rs` | Runtime/family dispatch tests | Planned |
| SDK `tools/base/tool.py::BaseAction` and `tools/elitea_base.py::BaseToolApiWrapper.run` | Map selected tool name to bounded invocation | `src/toolkits/invocation.rs` | Argument schema, callback event, cancellation and safe-error tests | Planned |
| SDK `runtime/toolkits/security.py` | Separator-insensitive blocked toolkit/tool policy | `src/toolkits/policy.rs` | Alias and blocked-policy corpus | Planned |
| SDK `runtime/middleware/sensitive_tool_guard.py` | Sensitive effect admission | `src/agents/sensitive_tools.rs` | Exact invocation-ID and at-most-once tests | Planned |

## Family inventory

`Check` means the Python configuration implements a live or authorization-aware
`check_connection`. Tool counts exclude dynamic OpenAPI/MCP/application tools.
Indexing tools are recorded as a later overlay in `indexing.md`.

| Configuration family | Python configuration symbol | Python toolkit symbol(s) | Fixed tools | Check | Rust targets | Status / notable gate |
| --- | --- | --- | ---: | :---: | --- | --- |
| `github` | `configurations/github.py::GithubConfiguration` | `tools/github::EliteAGitHubToolkit` | 44 | Yes | `configurations/families/github.rs`; `toolkits/families/github/` | Planned; anonymous/PAT/basic/App auth and all tools required |
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
