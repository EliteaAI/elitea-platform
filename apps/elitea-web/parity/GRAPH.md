# F5 — Named-export import graph and the collapsed 26–71% band

**Unit:** F5 (Wave 0) · **Date:** 2026-07-26 · **Source:** `apps/elitea-ui/src` @ `a55f36cf` (read-only main checkout; 1,773 `.js/.jsx` files, 220,941 logical lines — `wc -l` reports 220,940 because `[fsd]/pages/agent-hub/index.js` lacks a trailing newline)
**Deliverables:** `parity/module-graph.json`, `parity/wave2-partition.json`, this file. Gate: `node scripts/check-partition.mjs`.

## 1. Headline

Spec §9.1 could only bound decomposability at module granularity: **26% exclusive is a lower bound, 71% shared an upper bound**, because 215+ pure re-export barrels inflate every closure. Resolving every import through barrels to the defining symbol collapses the band:

| bucket | files | LOC | % of total LOC |
|---|---:|---:|---:|
| **exclusive to one route domain** | 415 | 63,465 | **28.7%** |
| **genuinely shared across ≥2 domains** | 973 | 139,048 | **62.9%** |
| shell-only (eager chunk from `root.jsx`, no domain closure) | 87 | 8,483 | 3.8% |
| unreachable under tree-shaken semantics | 298 | 9,945 | 4.5% |

Of the 298 unreachable: **190 are the bypassed pure barrels themselves (802 LOC)** and **108 are genuinely dead files (9,143 LOC)** — independently corroborated by the knip figure the spec cites in R-D1 (104 files / 7,421 LOC).

**So the true coupling number is 62.9%, not 71% — and not anywhere near 26%.** The barrels were inflating *closure membership* (per-domain closures shrank 26–69%, see §3) far more than they were masking *real* coupling. What saves Wave 2 is not the raw number but *where* the shared code lives (§4).

## 2. Method

- Parser: `@babel/parser` **8.0.4** (`sourceType: 'module'`, `plugins: ['jsx']`, `errorRecovery`), API verified against current docs via context7 on 2026-07-26. 0 parse errors. Dynamic `import()` surfaces as `ImportExpression` (Babel 8 AST); the legacy Babel 7 `CallExpression{callee.type:'Import'}` shape is also handled.
- `@/` alias → `src/` per `apps/elitea-ui/vite.config.js` `resolve.alias` (confirmed against `jsconfig.json` `paths`). Resolution candidates: exact, `.js`, `.jsx`, `/index.js`, `/index.jsx`; asset imports (`.svg` incl. `?react` svgr, `.css`, images, `.json`) recorded but excluded from module nodes. **0 unresolved specifiers.**
- Handled: named/default/namespace/side-effect imports, `export {x} from`, `export * from`, `export * as ns from`, import-then-re-export barrels (`import X from './X'; export default X`), dynamic `import()` with literal source (counts as an edge, kind `dynamic`).
- **Barrel resolution:** an import of symbol `s` from module `M` creates edges to the file(s) that *define* `s`, chasing re-export chains with cycle guards. A **pure re-export barrel** (all top-level statements are imports/re-exports) contributes no edge of its own — with one deliberate exception: a barrel that forwards via a *namespace* import (`import * as H from './x'; export { H }`) keeps the namespace-import edges, because the whole target module is reachable through the exported object. Exactly 2 such forwarders exist (`[fsd]/shared/lib/helpers/index.js`, `[fsd]/entities/credential-warning/helpers/index.js`), accounting for the 11 barrel-originated edges in `module-graph.json`. A *mixed* module (local code + re-exports) is kept as an edge target in addition to the defining file, because its top level executes. Namespace / side-effect / dynamic imports of a barrel conservatively expand to **all** its transitive re-export targets. Domain entries that are themselves barrels are seeded with their expansion.
- Stats: 248 `index.js*` files, **234 pure re-export barrels** (spec's grep-based count was 215; the AST detector also catches `import`-then-`export` forwarders). 6,694 named-import resolutions; **1,950 (29.1%) passed through ≥1 barrel** and were re-pointed to defining files. 1 unresolved symbol (`useMakeConfigurationDefaultMutation` requested from `@/api/configurations` by the itself-dead `hooks/credentials/useCredentialActions.js`; conservative module edge kept).
- Closures: BFS over resolved edges from the 39 lazy entries in `[fsd]/app/routes/ProtectedRoutes.jsx:30-82` (`grep -c lazyWithRetry` on those lines → 39), grouped into the 12 §9.1 domains. **Shell** = static-only closure from `[fsd]/app/root.jsx` (the app boots there per `index.html:41`; dynamic-only edges excluded = "in no lazy chunk"). LOC = logical lines: newline count plus one for a final unterminated line (equals `wc -l` for every file except the one noted in the header).
- Domain-grouping judgement call: **`[fsd]/pages/agent-hub` is counted in `misc`** (§9.1's misc list omits it; §9.3 groups `agents-hub` into A13, which is a misc-family unit). This is why misc's closure grew vs the old table.
- Validation anchors: the **mcp** row reproduces the spec's independent measurement exactly (1 file / 222 LOC); dead code ≈ knip; per-domain closure *counts* are ≤ the §9.1 table's in every domain (strictly smaller in 11 of 12; equal for mcp at 1 = 1). Membership-level subset checks against the old measurement are not possible — §9.1 published only counts.
- **`module-graph.json` format (`module-graph/v2`, columnar):** the v1 object-per-edge encoding was 1,637,289 bytes and `scripts/no-binaries-check.sh` caps every tracked file at 1 MiB, so nodes and edges are index-encoded with no information loss (decode round-trip verified deep-equal against v1). `nodes[i] = [file, loc, layerIdx, bucketIdx, [domainIdx…], pureBarrel 0|1]` and `edges[j] = [fromNodeIdx, toNodeIdx, [kindIdx…], [symbols…]]`, where node indices are positions in `nodes` and the other indices point into the sorted `vocab.layers` / `vocab.buckets` / `vocab.domains` / `vocab.kinds` arrays; `stats` is unchanged from v1. Deterministic: node order = sorted directory walk, edge order = first discovery over that walk, vocabularies sorted, `JSON.stringify` without indentation.

## 3. Per-domain table (old §9.1 module-granularity → F5 named-export granularity)

| Domain | closure files old→new | closure LOC old→new | exclusive files old→new | exclusive LOC old→new |
|---|---|---|---|---|
| chat | 1,206 → **895** | 156,391 → **137,490** | 107 → **113** | 18,252 → **19,423** |
| settings | 1,009 → **373** | 117,989 → **52,070** | 91 → **80** | 12,295 → **12,323** |
| artifacts | 956 → **299** | 113,992 → **42,038** | 38 → **41** | 6,213 → **6,699** |
| misc (incl. agent-hub, see §2) | 990 → **496** | 113,553 → **59,370** | 48 → **71** | 5,253 → **7,657** |
| analytics | 207 → **113** | 23,929 → **19,032** | 19 → **18** | 3,746 → **3,848** |
| skills | 961 → **525** | 111,547 → **73,294** | 23 → **32** | 2,941 → **3,866** |
| credentials | 918 → **439** | 107,030 → **54,661** | 13 → **20** | 1,973 → **2,698** |
| agents | 1,087 → **722** | 129,687 → **101,948** | 13 → **14** | 1,775 → **2,579** |
| pipelines | 1,168 → **834** | 143,856 → **119,192** | 10 → **11** | 1,724 → **2,486** |
| apps | 952 → **613** | 111,126 → **82,868** | 11 → **10** | 1,086 → **1,107** |
| toolkits | 949 → **620** | 111,098 → **83,578** | 4 → **4** | 557 → **557** |
| mcp | 1 → **1** | 222 → **222** | 1 → **1** | 222 → **222** |
| shell-only | 78 → **87** | 6,803 → **8,483** | — | — |

Reading: closures shrink dramatically (settings −63% files, artifacts −69%), and the freed files split between *exclusive* (which **rose** 26% → 28.7% — barrels were hiding decomposability) and *unreachable*. Exclusive LOC rose in 10 of 12 domains.

## 4. Where the shared 62.9% actually lives — the fact that decides Wave 2

The 973 shared files split by layer:

| slice of the shared bucket | files | LOC | who owns it in the new app |
|---|---:|---:|---|
| substrate layers (`shared/ui`+icons, legacy `components/`+`ComponentsLib/`, `hooks/`, `api/`, `common/`, `utils`, `entities/`, slices, theme, app glue) | 520 | 64,735 | **Wave 0/1 units** (S1–S8, E1, F3/F4, R1–R3, T1) — by design |
| feature/page layers (`[fsd]/features`, `[fsd]/pages`, `[fsd]/widgets`, legacy `pages/`) | 453 | 74,313 | **Wave-2 units** — the real contention surface |

Of the 74,313 LOC of feature-layer shared code, **67,343 LOC (374 files) assigns cleanly to exactly one Wave-2 unit** by directory identity — the "sharing" is *consumption across domains, not co-ownership* (e.g. the flow-editor is in 2 domain closures because agent pages embed pipelines; in the new app A2 owns `features/pipelines/` and everyone else imports its public API). 6,970 LOC route to Wave 1; only **14 files needed multi-unit assignment** (all listed in `wave2-partition.json`), and only 3 files >300 LOC are genuine cross-domain risks (§6).

Old-app reachable files not owned by a Wave-2 unit route to Wave 0/1 as: S1 198f/29,807 LOC · S3 140f/14,826 · E1 56f/7,186 · S2 78f/2,997 · T1 5f/1,826 · S4 11f/1,386 · F4 6f/828 · R1 10f/773 · R2 10f/507 · S6 1f/165 · R3 1f/93 (`pages/ProjectSwitcher.jsx` → ROUTE-070) · S5 2f/76 · F3 2f/59 · unrouted 6f/679.

## 5. Wave-2 partition (full map in `wave2-partition.json`)

| unit | owned target dirs (zero overlap, gate-checked) | old-app inputs |
|---|---|---:|
| C1 chat model | `src/processes/chat/model/` | 35 f / 4,334 LOC |
| C2 conversation list | `src/features/chat-conversation-list/` | 26 f / 4,574 |
| C3 composer/attach/ASR-TTS | `src/features/chat-input/` | 38 f / 7,123 |
| C4 messages/canvas/swarm | `src/features/chat-messages/` | 43 f / 11,915 |
| C5 participants | `src/features/chat-participants/` | 33 f / 4,685 |
| C6 chat page+widgets | `src/pages/chat/`, `src/widgets/chat/` | 33 f / 10,352 |
| A1 agents | `src/features/agents/`, `src/pages/agents/` | 91 f / 17,021 |
| A2 pipelines+flow editor | `src/features/pipelines/`, `src/pages/pipelines/` | 130 f / 23,188 |
| A3 skills | `src/features/skills/`, `src/pages/skills/` | 41 f / 5,155 |
| A4 toolkits (+sharepoint auth) | `src/features/toolkits/`, `src/pages/toolkits/` | 81 f / 14,102 |
| A5 mcps | `src/features/mcps/`, `src/pages/mcps/` | 21 f / 3,745 |
| A6 apps | `src/features/apps/`, `src/pages/apps/` | 9 f / 1,082 |
| A7 credentials | `src/features/credentials/`, `src/pages/credentials/` | 31 f / 4,082 |
| A8 artifacts | `src/features/artifacts/`, `src/pages/artifacts/` | 44 f / 8,556 |
| A9 settings (+user settings) | `src/features/settings/`, `src/pages/settings/` | 87 f / 12,093 |
| A10 analytics | `src/features/analytics/` | 16 f / 3,883 |
| A11 notifications | `src/features/notifications/` | 14 f / 1,872 |
| A12 user-public | `src/pages/user-public/` | 11 f / 1,298 |
| A13 onboarding/help/hub/tours | `src/pages/{onboarding,help-center,agents-hub,mode-switch}/` | 81 f / 7,091 |
| A14 admin | `src/pages/admin/` | apps/admin-ui @ `0f9d247` (separate repo) |
| A15 maintenance entry | `src/entries/maintenance/` | Maintenance-UI repo; in-app banner → W-shell |
| W-shell | `src/widgets/{sidebar,create-button,app-shell}/` | 54 f / 5,742 |

Notable judgement calls (all encoded as rules in the emitter, visible in `wave2-partition.json`): `pages/UserSettings` + `[fsd]/pages/user-settings` → A9; interactive-tours engine + per-domain tour constants → A13; import-wizard modal → W-shell (opened from the create button); `[fsd]/widgets/Notifications` → A11 while the sidebar `NotificationButton` stays W-shell.

## 6. Partition risks

3 high and 3 informational — full records in `wave2-partition.json.partitionRisks` (the emitter also has a `medium` severity tier for parallel same-domain siblings, e.g. A11/A12/A13; zero such records fired):

| severity | file (old app) | LOC | exclusive to | needed by | resolution required |
|---|---|---:|---|---|---|
| **high** | `pages/NewChat/PipelineEditor.jsx` (+`useEditPipeline`, `usePipelineCreation`) | 625 | chat | **A2** + C6 | The in-chat pipeline editor is chat-exclusive today but is A2 subject matter. Decide before Wave 2: A2 owns the editor feature; C6 composes it via A2's public API. |
| **high** | `pages/NewChat/AgentEditor.jsx` (+3 hooks, `CreateApplicationSaveButton`) | 374 | chat | **A1** + C6 | Same pattern for agents. |
| **high** | `pages/NewChat/ToolkitEditor.jsx` (+4 files) | 335 | chat | **A4** + C6 | Same pattern for toolkits. |
| info | `…/conversation-list/ui/conversations/Conversations.jsx` | 769 | chat | C2 ← C6 | Inside the C1–C6 chain, which is serial by design (§9.2). |
| info | `pages/NewChat/CanvasEditor.jsx` | 678 | chat | C4 ← C6 | idem |
| info | `…/useMoveToFolderConversation.hooks.js` | 332 | chat | C2 ← C6 | idem |

The three high risks are one pattern: **the old chat page in-lines the create/edit editors of three other domains**. The layer model already has the answer (features compose upward through widgets); the partition encodes it by assigning those files to both the owning A-unit and C6, and the A-unit must publish the editor through its `index.ts` **before C6 starts** — i.e. schedule A1, A2, A4 no later than the C6 leg of the chat chain.

## 7. Wave-2 parallelism verdict

**Wave 2 keeps its parallel plan. The §10.2 upper band is *not* triggered.** The trigger condition was "if the real figure is near 71%, Wave 2 loses most of its parallelism". The real figure is 62.9% — but the operative facts are stronger than the headline number:

1. **The write-conflict scenario §9.1 feared does not materialize under the layered plan.** 46.6% of the shared LOC (64,735) sits in substrate layers that Wave 0/1 owns exclusively; of the feature-layer shared code, 90.6% by LOC maps to exactly one Wave-2 owner. Total multi-owner surface: 14 files. Owned target directories overlap zero (gate-checked).
2. **Exclusive code — the per-unit private surface — grew from 26% to 28.7%** once barrels stopped smearing closures. Decomposability is slightly *better* than the §9.1 lower bound.
3. **The serialization the plan already assumed is confirmed, and is sufficient:** the only intra-domain cross-unit imports >300 LOC are C2/C4 → C6, inside the explicitly serial chat chain. No new serialization is needed beyond §6's constraint (A1/A2/A4 editor APIs before C6).
4. **Consequences for effort (§10.2):** stay on the ~900 agent-hour midpoint for Wave 2. The number this analysis *does* move is confidence in Wave 1 as the critical path: Wave-1 units absorb ~65k LOC of shared substrate (S1 alone fronts 198 old files / 29.8k LOC of legacy component surface), so Wave-1's 260–450h band should be watched, not Wave-2's.

## 8. Reproduce

Tooling (not in-repo, per F1 ownership of `package.json`): `$SCRATCHPAD/f5-graph/{analyze.mjs,emit-deliverables.mjs}` with `@babel/parser@8.0.4`. Run `node analyze.mjs` (graph + closures + buckets), then `node emit-deliverables.mjs` (deliverables + risk scan), then `node apps/elitea-web/scripts/check-partition.mjs` (gate; proven to fail on injected missing-unit / overlap / uncovered-domain violations).
