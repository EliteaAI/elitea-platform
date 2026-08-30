# Inventory: what is not ported, not wired, or only reachable by hand

**Status:** proposed · **Created:** 2026-08-30 · **Scope:** elitea-main, elitea-llm-gateway,
elitea-worker-*, admin SPA, elitea-web

**Baseline:** measured against upstream `EliteaUI` @ `20b23c42` (2026-08-28),
read from the standalone clone. The submodule `apps/elitea-ui` is **still pinned
at `a55f36cf` (2026-07-08), 774 commits behind**, and moving it is a scoped task
of its own — see Wave 0.1. The staleness is not cosmetic: a first pass of this
document taken against the old pin concluded "route parity is done". It is not.
Re-run the comparison whenever the pin moves.

## What this document is

An inventory of everything the platform still cannot do through its own product
surfaces, plus a port plan. Three questions separate the buckets, and mixing them
is what has made previous "what's left" lists unusable:

1. **Does the capability exist in code?** If not → *unported*.
2. **If it exists, is it switched on in a default install?** If not → *built, off*.
3. **If it is on, can a user reach it without SQL?** If not → *no surface*.

A fourth bucket, **deliberate non-goals**, is listed last so nobody schedules
work against a promise the target architecture retired on purpose.

Evidence for every row is a file path in this repository. Rows marked
*unverified* are inferred from a doc comment rather than from a run.

---

## A. Bootstrap and operations — done by SQL today

These are the steps `deploy/scripts/standalone-stack.sh` and
`apps/elitea-web/scripts/e2e-stack.sh` perform with `psql`, that no product
surface performs. A greenfield install is not usable until someone runs them by
hand. This is the highest-value bucket: each row blocks a real deployment.

| # | Gap | Evidence | Why it matters |
|---|---|---|---|
| A1 | **Worker identity enrolment.** `elitea_runtime.workload_sessions` has **no writer anywhere in the repository** — not a route, not a migration, not the worker. | `standalone-stack.sh:265-300`; grep for `workload_sessions` finds only readers (`repos/workload_sessions.go`, `postgres_content.go`) and the DDL (`shared/0034`) | Empty table → every `ClaimCommand` is refused → **agent execution is dead on any fresh deploy**, with a failure that mimics a claim-fence wedge |
| A2 | **First global admin under SSO.** `initial_global_admins` is consumed only by `FormGraph`. | `authcomposition/graph.go:402`, `config.go:145` | With OIDC/SAML as the auth plane there is no way to make the first admin except `INSERT INTO auth_core__user_role` |
| A3 | **LLM credential + model catalogue seeding.** The standalone script writes 8 `p_N.configuration` rows directly. | `standalone-stack.sh:457-601, 738-803` | The admin surfaces exist, but the write path they need is behind `ELITEA_CONFIGURATIONS_MUTATION_ENABLED` (see B1). Without it: *"the requested model is not in the project's catalog"* |
| A4 | **Artifact bucket must pre-exist.** elitea-main probes the object store at boot and refuses to start. | `deploy/README.md` "What a Kubernetes install does NOT give you" | The migration Job fails and the release aborts, before anything can create it |
| A5 | **`CREATE DATABASE` (agent-state) and `CREATE EXTENSION vector`.** | same | Covered by the chart's `db-init` hook Job, but needs an administrator DSN supplied out of band. Compose has no equivalent hook |
| A6 | **No model-cache pre-seed for `pylon-indexer` on Kubernetes.** compose's `model-cache-init` has no chart equivalent. | `deploy/README.md` | First index run downloads the embedding model inside the pod |

**Not a gap, despite appearing in the seed scripts:** PAT rows
(`POST /api/v2/auth/token/` + the `/settings/tokens` page are both real —
`v2/auth/handler.go:76-79`), per-project roles and the project system PAT (both
are provisioning steps — `projectprovisioning/steps.go`), central RBAC
(seeded by migrations `0060`–`0091`), and the personal project (#609). The seed
scripts bypass working surfaces there for speed, not because the surface is
missing.

---

## B. Backend — built but not switched on

Every one of these is implemented, tested, and **off in a default Helm install**.
`deploy/helm/elitea/values.yaml:455-583` states the reason for each: the
capability needs production authentication, which the default chart does not
build, and `cmd/elitea-main` refuses to start with the flag on and auth off.

| # | Flag | What is dark | Gap? |
|---|---|---|---|
| B1 | `ELITEA_CONFIGURATIONS_ENABLED` | eight configuration + model-catalogue routes; the dependency agent dispatch and index ingest both compose through | **Yes** — this is what makes A3 manual |
| B2 | `ELITEA_CONFIGURATIONS_MUTATION_ENABLED` | three configuration **write** routes that *win* the path from the compatibility routes every install serves | **Yes, and it is a cutover** — they take a different request shape from the one `apps/elitea-web` sends today. Web-client work is part of turning this on |
| B3 | `ELITEA_PROJECT_INFO_ENABLED` | real project-info handler | **Yes, silently** — off, the prototype handler answers **200** with zero teammates and a null icon. The project screen renders that as truth |
| B4 | `ELITEA_INDEX_TYPES_ENABLED` | index/document-type read | **Yes** — off, the toolkits handler answers a static six-loader list no data backs |
| B5 | `ELITEA_APPLICATION_SKILLS_ENABLED` | attached-skills read | **No** — the fallback answers the same rows in the same envelope |
| B6 | `runtime.enabled` | the whole runtime plane (agent execution, index dispatch/scheduling) | Prerequisite for A1 mattering at all |

**The real work here is not flipping flags.** It is making the default chart
build production authentication so the flags *can* be on, and closing the B2
request-shape cutover. Until then every install is either "auth off, capabilities
dark" or "hand-configured".

---

## C. Backend — implemented refusals and unported surfaces

Routes that exist and answer honestly that they cannot serve. `501` here is
deliberate (see `v2/analytics/handler.go:70-100` for why it is not `500`), so
these are *known* gaps, not bugs.

### C1. Genuinely missing, worth porting

| Surface | Route / file | State |
|---|---|---|
| **MCP `tools/call` execution** | `v2/mcp/server.go:217`, `registry.go:71,188` | Listing is real; running is not. Needs the agent runtime (agents) and the Python worker's toolkit dispatch (toolkits). Returns `isError: true` naming what is missing, never an empty success |
| **MCP SSE pair** (`GET /<pid>/sse` + `POST /<pid>/messages`) | `v2/mcp/handler.go:21` | Not ported. The modern streamable-HTTP transport is; this is the deprecated one |
| **Analytics by agent / by tool** | `v2/analytics/handler.go` | Usage and users are answerable over the request log (`0099`); agents and tools have no dimension to group by |
| **Billing dimensions** | `internal/governance` | Accumulators hold money per `(scope, scope_id, period)` only. No model, user, agent, token or call breakdown exists anywhere |
| **TTS voice list** | `v2/configurations/handler.go:1641,1657` | 501. The reference reads voices from the provider |
| **Realtime / audio streaming** | `llm-gateway/internal/llmproxy/realtime.go:450`, `audio.go:187` | 501 on the realtime route; `stream_format` unsupported on speech |
| **SCIM filter grammar** | `internal/scimdirectory/filter.go:122` | Grouping and `and`/`or`/`not` not implemented; some PATCH paths answer 501 (`scim/users.go:350`, `groups.go:283`) |
| **Conversation attachment cleanup** | `repos/conversations.go:1123` | pylon's `delete_attachment` is not ported — attachments outlive their conversation |
| **Agent markdown export** | `apps/elitea-web/.../ExportApplicationButton.tsx:44` | The Go router has no markdown export operation |
| **Config field suggestions** | `v2/admin/config_suggestions.go:64` | 501 whenever the deployment cannot enumerate the toolkit registry — i.e. always, on a Go-only stack |

### C2. Awaiting an architectural decision, not a port

| Surface | State |
|---|---|
| **Service descriptors / provider hub** | `v2/eliteacore/service_descriptors.go:145`. Successor is ADR-0012/P3. DeepWiki and Inventory already deploy separately and self-register — only the hub is missing |
| **Prebuilt MCP config machinery** | Partially ported (0092 catalogue); pylon's writer was not |

---

## D. Admin UI

The admin SPA (`services/elitea-main/.../admin/`) is close to complete: Projects,
Users, Roles, Permission matrix, Secrets, Audit trail + heatmap, Schedules,
App requests, Identity providers, SCIM bindings, MCP servers, Platform models,
LLM proxy (providers/models/usage/logs/alerts/status), Gateway governance,
Features, Configuration.

What the Configuration page still withholds
(`v2/admin/config_schemas.go`; the server declares `unavailable_reason`, the SPA
only renders it):

| Section | Reason | Action |
|---|---|---|
| `observability` | pylon plugin config | **Port** — needs a Go-side observability settings store, or removal if OTel config is chart-owned |
| `runtime` | pylon plugin config | **Port or remove** — decide whether runtime tuning is authored or chart-owned |
| `admin_panel` | pylon plugin config | **Port or remove** |
| `service_descriptors` | provider hub is pylon-only | Blocked on C2 |
| `mcp_servers` | → `managed_surface: mcp_prebuilt_servers` | Done, no work |
| `llm_proxy` | → `managed_surface: llm_proxy` | Done, no work |
| `auth` | → `managed_surface: identity_providers` | Done, no work |
| `governance` | authored at `/admin/gateway/governance` | Done, no work |
| `agent_publishing.validation_rules`, `skill_publishing.validation_rules` | field-level; validation is deterministic here | Correctly withheld |

Missing admin surfaces (new work, not ports):

- **D1. Workload-session enrolment** — the UI for A1. A page that registers a
  worker identity (identity, producer id, expiry) and revokes it.
- **D2. First-admin bootstrap** — a one-time claim flow, or chart-driven
  promotion, that works on the OIDC plane (A2).

---

## E. Product UI (elitea-web)

The old UI is a **moving target**: it gained 774 commits between the previous
submodule pin and `20b23c42`, and several of them are whole product areas that
elitea-web has no counterpart for. Parity is therefore not a fixed finish line,
and any plan that treats it as one will keep discovering new gaps at cutover.

The several hundred `NOT ported` comments inside `apps/elitea-web/src` are, on
inspection, deliberate micro-fidelity drops (tour targets, brand icon resolvers,
styling overrides) — not features. The gaps that matter are these.

### E0. Whole features added upstream since the old pin — nothing ported

| Feature | Upstream | elitea-web | Backend |
|---|---|---|---|
| **Agent Evaluation** — suites, datasets, cases, dimensions, runs, scorecards, human scores, import/promote, platform catalog | `widgets/evaluation/` (61 files, own `evaluationApi.js`) | **absent** | **absent** — 21 endpoints under `elitea_core/eval_*`; grep for `eval_suite|eval_dataset|eval_run|eval_dimension|eval_binding` across `services/` returns **0** |
| **Shared conversation** — public read-only chat at `/shared/chat/:token` | `pages/shared-conversation/` (4 files) | absent | unverified |
| **Skill Hub** | `features/skill-hub/` (18 files, own `skillHubApi.js`) | absent (`PublicSkillsCatalog.tsx` is a different surface) | unverified |
| **NPS survey** | `widgets/nps-survey/` (18 files, own API) | absent | absent |
| **Elitea Catalog** (`/elitea-catalog`) — supersedes `agents-hub`, which upstream has deleted | `pages/elitea-catalog/` | still ships the superseded `agents-hub` | n/a |
| **Compare versions**, **indexing report**, **edit-entity-with-AI** | `entities/compare-versions`, `entities/indexing-report`, `entities/edit-entity-with-ai` | absent | unverified |

Agent Evaluation is the largest single item in this document, in either surface,
and it is also live product work — the `feat:agent_eval` issues in
`elitea_issues` are open and being added to now.

### E0b. Routes added upstream, not present in elitea-web

`/toolkits/:tab/:toolkitId/test`, `/mcps/:tab/:mcpId/test`,
`/mcps/:tab/:mcpId/history`, `/toolkits/:tab/:toolkitId/index/:indexName/search`.
The toolkit index and run-history routes are **correctly** folded into tabs here
(`features/toolkits/indexes/`, `IndexesTab.tsx`, `run-history`), so verify each
of these is genuinely missing rather than re-homed before scheduling it.

`/settings/project-context` + `/settings/project-context/edit` are ported but at
a **different path** (`/settings/project-params`) — a deep-link and
documentation mismatch, not a missing feature.

### E1+. Feature-scale gaps in what was ported

| # | Gap | Evidence | Size |
|---|---|---|---|
| E1 | **Chat canvas editor is a shell.** CodeMirror host, Mermaid output, markdown-table editor, undo/redo, quick-fix, presence socket and CSV import are all `TODO` placeholders | `features/chat-messages/ui/canvas/CanvasEditor.tsx` (18 TODOs), `Canvas.tsx` (4), `CanvasEditHeader.tsx` | L |
| E2 | **Playback message list** not rendered | `features/chat-messages/ui/playback/PlaybackChatBox.tsx:307` | M |
| E3 | **Long-term memory settings** = "Coming soon" placard | `features/settings/ui/profile/ProfileLongTermMemory.tsx:27` | M (needs a backend too) |
| E4 | **Custom skill icons** = "coming soon" tooltip | `features/skills/ui/SkillForm.tsx:86` | S |
| E5 | **Per-word TTS highlight sync** dropped | `features/chat-messages/ui/chat-box/ApplicationAnswer.tsx:18` | S |
| E6 | **Agent set-default-version** — router answers 405; the UI shape was not ported | `features/agents/model/useSetDefaultVersion.ts:26` | S (backend first) |
| E7 | **`/artifacts/edit-bucket`** route missing (referenced by the project switcher, never defined) | `src/routes/$projectId.$.tsx` | S |
| E8 | **Support assistant**: attachments, screenshots and mermaid deliberately not ported | `v2/supportassistant/handler.go:51` | M, optional |

---

## F. Deliberate non-goals — do not schedule

Listed so they stop reappearing in gap reviews. Each is something the target
architecture drops on purpose, and each already answers honestly.

- Pylon runtime administration — plugin reload, remote plugin config, plugin
  listing (`v2/admin/handler.go:184`).
- Arbiter task nodes (`v2/admin/handler.go:289`), and the Arbiter/RabbitMQ
  transport generally (AGENTS.md forbids it; provisioning drops `rabbit_vhost`).
- Plugin version reporting / system info from Arbiter announcements
  (`v2/admin/handler.go:132`).
- InfluxDB provisioning (`projectprovisioning/steps.go`).
- The MCP `api` tool category — republishing REST endpoints as MCP tools. The
  per-endpoint opt-in list does not exist here, and inferring one would publish
  the admin surface to any PAT holder (`v2/mcp/handler.go:56`).
- The admin Configuration `advanced` section (removed 2026-08-24).
- `AUTH_DEV_MODE` — to be deleted, not completed (ADR-0017).

---

## Port plan

Sequenced by what unblocks the most. Sizes are rough and per-surface.

### Wave 0 — stop measuring against a moving target  *(do first, it is cheap)*

| Step | Work | Size |
|---|---|---|
| 0.1 | **Refresh the `apps/elitea-ui` pin, then keep it current.** It is the parity baseline; at 774 commits stale it produced a false "parity done" reading. This is **not** a one-line gitlink bump — bumping it to `20b23c42` was attempted and reverted, because the pin is load-bearing for CI. Verified first two blockers: (a) `scripts/gen-brand-tokens.mjs` crashes with `Identifier 'white' has already been declared` — upstream's `lightPalette.js` no longer imports `white` from `darkPalette.js` while the generator still injects it; (b) with that fixed, it throws `unhandled asymmetric token id: background.folder.shadow`, and every such token needs a hand-authored `SYMMETRY_FILLS` decision. Expect a changed `default.pack.json` and therefore **visual-baseline regeneration**, which must run through the `ci-web-e2e` `workflow_dispatch`, never locally. After it lands, add a CI check that fails when the pin falls more than N commits behind `origin/main`. | M |
| 0.2 | **Decide the cutover contract for upstream's in-flight work.** Agent Evaluation is being built in the old UI *now*. Either elitea-web ports it after the fact (permanent catch-up), or new product work targets the Go stack first. This is a programme decision, not an engineering one, and everything in Wave 5 depends on the answer. | — |

### Wave 1 — make a fresh deploy work without SQL  *(blocks everything)*

| Step | Work | Size |
|---|---|---|
| 1.1 | **Workload-session enrolment (A1).** Write path in elitea-main: `POST/DELETE /api/v2/admin/workload_sessions`, an issuance helper the worker's cert identity maps to, and a chart hook that enrols the shipped worker identity on install. Then D1 (admin page). | L |
| 1.2 | **First-admin bootstrap (A2).** Extend `identity.Provision`'s `InitialGlobalAdmins` consumption to the OIDC plane, or add a chart-driven promotion Job. | M |
| 1.3 | **Boot preconditions (A4/A5/A6).** Make the artifact bucket creatable by the migration/`db-init` Job instead of being a precondition; add a model-cache init container to the chart. | M |
| 1.4 | **Acceptance gate.** One CI job: fresh empty DB → `helm install` → login → create agent → chat turn completes, **with zero `psql`**. Without this gate the bucket refills. | M |

### Wave 2 — turn the dark capabilities on  *(unblocks A3, B3, B4)*

| Step | Work | Size |
|---|---|---|
| 2.1 | Make the default chart build production authentication, so B1–B4 can be `true` without a CrashLoopBackOff. | L |
| 2.2 | Flip `ELITEA_PROJECT_INFO_ENABLED` and `ELITEA_INDEX_TYPES_ENABLED`. Both are pure wins; the prototype fallbacks answer 200 with wrong data today. | S |
| 2.3 | **B2 cutover:** align `apps/elitea-web`'s configuration-write request shape with the mutation routes, then enable `ELITEA_CONFIGURATIONS_MUTATION_ENABLED`. This is what retires A3. | L |
| 2.4 | Delete `AUTH_DEV_MODE` (ADR-0017) once 2.1 lands. | S |

### Wave 3 — close the honest refusals

| Step | Work | Size |
|---|---|---|
| 3.1 | **MCP `tools/call`.** Agents via the runtime plane; toolkits via the worker's dispatch. Highest external-integration value of anything in section C. | L |
| 3.2 | **Analytics + billing dimensions.** Add the dimension columns the request log needs, then agent/tool/model breakdowns. Schema change first — the accumulators cannot be retrofitted. | L |
| 3.3 | Conversation attachment cleanup; agent markdown export; set-default-version (E6's backend). | M |
| 3.4 | SCIM filter grammar and the 501 PATCH paths. Only if an enterprise SCIM client needs it — scope on demand. | M |
| 3.5 | TTS voices, realtime/audio. Scope on demand. | M |

### Wave 4 — admin UI completion

| Step | Work | Size |
|---|---|---|
| 4.1 | Decide `observability` / `runtime` / `admin_panel`: author in the platform, or declare chart-owned and **remove the section**. A withheld section is a promise; removal is a legitimate answer (`advanced` set the precedent). | M |
| 4.2 | Config field suggestions (C1) — needs a Go-side toolkit registry enumeration. | M |
| 4.3 | Service descriptors — blocked on ADR-0012/P3. | — |

### Wave 5 — product UI

| Step | Work | Size |
|---|---|---|
| 5.1 | **Canvas editor (E1).** The single largest UI gap; ship in slices — CodeMirror host, then Mermaid, then table editor, then presence. | L |
| 5.2 | Playback list (E2), skill icons (E4), edit-bucket route (E7). | M |
| 5.3 | Long-term memory (E3) — needs a backend; sequence after Wave 3. | L |
| 5.4 | TTS highlight (E5), support-assistant attachments (E8). Optional. | M |
| 5.5 | **Agent Evaluation (E0)** — 21 backend endpoints plus a 61-file UI area. Own workstream, not a task; sequence per 0.2. | XL |
| 5.6 | Shared conversation, Skill Hub, Elitea Catalog rename, compare-versions, indexing report, edit-with-AI (E0). | L |

---

## Two rules this repository keeps re-learning, and that this plan depends on

1. **Absence reads as correctness.** A missing writer, an unenumerated registry,
   an empty table — all answer "fine" to every check that does not assert
   presence. Every Wave-1 step needs a test that fails when the thing is absent,
   not one that passes when nothing throws (A1 is exactly this shape).
2. **A 200 with a fallback body is worse than a 501.** B3 and B4 are dark
   capabilities whose fallbacks answer success with wrong data, which is why they
   went unnoticed. Prefer the refusal until the real handler is on.
