# Current application-skills parity evidence

Status: source-complete and production-composed behind the strict, default-off
`ELITEA_APPLICATION_SKILLS_ENABLED` Main-process gate. The Go route is not
deployed, no hybrid Traefik edge route is included in this slice, and the
current Pylon route remains the runtime owner.

This slice is independent of indexing admission, execution, output replay,
workers, LiteLLM, Redis, and shared-schema migrations. It reads only the
existing project-local skills tables after current authentication and project
RBAC succeed.

## Contract matrix

| Concern | Current application evidence | Go evidence | Parity statement |
| --- | --- | --- | --- |
| HTTP route | `elitea_core/api/v2/application_skills.py:API.url_params`; unchanged UI call in `EliteaUI/src/[fsd]/features/skill/api/skillsApi.js:getApplicationSkills` | `CurrentApplicationSkillsPath`; production router registration | Exact `GET /api/v2/elitea_core/application_skills/prompt_lib/{project_id}/{app_version_id}`. Flask integer segments accept zero, leading zeroes and arbitrary-size decimal values; the Go route matches the same decimal domain and bounds conversion only at the PostgreSQL integer query boundary. No UI change. |
| Permission and mode | `PromptLibAPI.get` requires `models.applications.applications.details`; recommended default-mode roles are admin, editor, and viewer | `CurrentApplicationSkillsPermission`; `CurrentApplicationSkillsMode`; existing PostgreSQL principal and RBAC resolvers | Exact permission and project mode. Authentication and dynamic project RBAC run before any tenant query. |
| Project tenancy | `_skill_session` opens `db.get_session(project_id)`, which maps the trusted numeric project to `p_<project_id>` | `tenant.Executor.WithinTx` verifies `centry.project`, derives the schema from a positive integer, installs transaction-local `search_path`, and owns rollback/commit | No caller-selected schema enters SQL. Cross-project role and same-ID tenant canaries are service-tested with PostgreSQL. |
| Selection | `get_available_skills_for_agent` filters `entity_version_id` and `entity_type == agent`, then projects the mapped skill and selected version | One parameterized query over `entity_skill_mapping`, `skills`, and `skill_versions` with the same filters and joins | Pipeline mappings and mappings for another application version remain absent. The current unspecified database order is preserved; the port does not invent sorting. |
| Successful item shape | Current keys are `name`, `description`, `skill_id`, `version_id`, `version_name`, `version_missing`, and `icon_meta` | `CurrentApplicationSkill` | Exact key names, scalar/null behavior, and nested `icon_meta` JSON. Current tenant schemas make `skill_version_id` NOT NULL and foreign-key it to `skill_versions`; the real PostgreSQL fixture does the same. The Python handler's defensive missing-version projection remains unit-tested only and is not claimed as current-schema evidence. |
| Successful envelope | Current handler returns `{"skills": skills, "max_skills": 5}` | `currentApplicationSkillsResponse`; `MaxCurrentApplicationSkills` | Empty lists encode as `[]`, not `null`. A nonexistent, zero or PostgreSQL-integer-out-of-range application-version decimal intentionally returns `200 {"skills":[],"max_skills":5}` without issuing an overflowing query. |
| Malformed path | Flask integer routing rejects a nonnumeric project or application-version segment before the handler | Numeric inner-route constraints and route-local not-found writer | `404` with the current Flask-RESTful message body. |
| Unexpected repository error | The current handler does not catch unexpected database exceptions; Flask-RESTful returns its generic internal error | `writeCurrentApplicationSkillsFailure` | `500 {"message":"Internal Server Error"}` with no database or tenant detail. |
| Main registration | Pylon owns the edge route today | Strict `ELITEA_APPLICATION_SKILLS_ENABLED`; disabled or unset leaves the route absent inside Go Main | The flag controls only Go Main's internal registration. It does not switch Traefik ownership. |
| Edge ownership and rollback | The hybrid gateway sends this path to current Pylon | No Centry hybrid route file or file-provider mount is changed by this commit | Cutover still requires a separate exact, default-off Traefik route seam. Rollback disables/removes that edge seam first, then disables the Main gate; no data rollback exists. |

## Read-only current-browser evidence

On 2026-07-27, a signed current UI session against project `2` observed:

- application version `1`: `200 application/json` with
  `{"skills":[],"max_skills":5}`;
- nonexistent positive version `999999`: the identical `200` empty response;
- a nonnumeric version segment: `404` with
  `{"message":"The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again."}`.

This proves current runtime behavior only. A same-session comparison against
the Go-owned route remains a deployment gate.

## Verification evidence

| Check | Boundary proved |
| --- | --- |
| `go test ./internal/api/v2/applicationskills ./internal/api ./cmd/elitea-main` | Handler/repository contract, authentication and RBAC ordering, exact production route ownership, strict environment parsing, and default absence. |
| `go test -race ./internal/api/v2/applicationskills ./internal/api ./cmd/elitea-main` | The same in-process paths under the race detector. |
| `go vet ./internal/api/v2/applicationskills ./internal/api ./cmd/elitea-main` | Static Go checks for the changed packages. |
| `ELITEA_TEST_DATABASE_URL=... go test -run 'TestCurrentApplicationSkills(RoutePostgresContractAndTenantIsolation|HTTPPostgresRBACAndTenantMatrix)$' ./internal/api/v2/applicationskills` | Real PostgreSQL transactions and current NOT NULL/FK mapping schema; active/suspended users, viewer/editor permission, wrong permission, platform-admin non-inheritance, active/suspended projects, cross-project denial, same-ID tenant isolation, and zero/oversized absent-version behavior. |

## Deployment gates

1. Keep `ELITEA_APPLICATION_SKILLS_ENABLED` unset during rollout preparation.
2. Add a separate Centry hybrid file-provider input whose default is the
   existing empty dynamic configuration. Its opt-in file must match only the
   exact GET path and route it through the existing stripped-header and
   ForwardAuth middleware to Go Main. Do not reuse or edit the indexing route
   file.
3. In a disposable environment, enable the Main gate only with the complete
   production authentication graph and the existing database schema. Verify
   the edge still reaches Pylon while the new edge seam remains disabled.
4. Enable the exact edge seam, then use the unchanged UI to compare attached
   skills with present versions and icon metadata, an empty version, zero,
   nonexistent positive and oversized decimal versions, a malformed version,
   viewer/editor access, cross-project denial, and suspended-user denial.
5. Confirm logs and traces contain no skill content, database details, or
   tenant schema names on failures.
6. Roll back the edge seam to its empty/default file before setting the Main
   gate to `false` (or removing it) and restarting Main; verify Pylon again owns
   the route.

The current attach path enforces the business maximum of five, but the read
query deliberately has no new SQL `LIMIT`, matching current behavior if stored
data has drifted. A future database constraint or consistency repair must be a
separate reviewed change before the read contract can safely enforce a hard
bound.
