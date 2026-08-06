# Plan: wire elitea-web routes to their built page components

**Status:** proposed · **Created:** 2026-08-06 · **Blocks:** PR #82 merge

## Problem

38 route files in `apps/elitea-web/src/routes/**` render `RouteShell` — a
33-line component emitting `<section><h1>{routeName}</h1></section>` and
nothing else. Two more (`/artifacts`, `/artifacts/create-bucket`) render
hand-written inline stubs added by PR #82.

The corresponding page components **already exist**, are unit-tested, and are
imported by nothing. `grep -rn "@/pages" src/routes` returns 8 hits, all under
`/settings` plus `mode-switch`.

This is not a design-fidelity problem and not missing feature work. Wave-2
built the pages to a documented route contract; the wiring step was never done.

### Evidence that the contract is already pinned

Every stub route's docstring names its target, e.g.
`src/routes/_shell/toolkits/$tab.tsx`:

```
ROUTE-029 `/toolkits/:tab` -> `Toolkits`
```

and `src/pages/toolkits/Toolkits.tsx:280` names the route back:

```
ROUTE-030-family (`/toolkits/:tab`, `/mcps/:tab`; spec §8.1); `isMCP` …
```

The prop variants the route docstrings specify (`isMCP`, `isApplication`,
credential `context`/`configurationMode`) are already implemented on the page
components. The map is 1:1 and self-documenting.

### Why CI is green

| Gate | Why it passes against a stub |
|---|---|
| E2E (62/62, PR #82) | asserts `data-testid` presence + URL changes only |
| `allRoutesSmoke.test.tsx` | a `RouteShell` renders without throwing |
| Visual regression | does not exist — no `toHaveScreenshot`, no `e2e/visual/` (issue #61, open) |

---

## Phase 0 — Freeze the map — **DONE**

Artifacts:

- `apps/elitea-web/parity/route-wiring-map.json` — 38 rows, one per route that
  renders scaffolding.
- `apps/elitea-web/scripts/build-route-wiring-map.mjs` — regenerates it;
  `--check` fails CI if the map drifts from the routes. Mechanical fields are
  re-derived from the route files on every run; only the `RESOLUTION` table is
  hand-authored.

Coverage is complete and verified: 35 routes render `RouteShell`, all 35 are in
the map, plus the 2 artifacts inline stubs and `/mode-switch`. Every row
resolves to an existing export (the generator exits non-zero otherwise), and
every row has a `ROUTE-NNN` docstring target.

### Result

| Status | Routes | Meaning |
|---|---|---|
| `ready` | **22** | Import swap; no route-owned state needed |
| `blocked-codegen` | **7** | Needs an injected writer whose endpoint is missing from the generated client |
| `needs-route-state` | **6** | Target needs props the route must own (tab/search state, nav callbacks) |
| `hybrid-defect` | **2** | Real page already rendered, with a `RouteShell` heading stacked above it |
| `page-is-stub` | **1** | Route is wired; the page itself is scaffolding |

### Finding 1 — the "backend gap" is a codegen gap, and the code says the opposite

`src/features/toolkits/api/toolkits.ts` claims, as a "REAL, EXHAUSTIVELY
VERIFIED BACKEND GAP", that 10 toolkit write operations "have NO generated
endpoint anywhere". That file also flags its own claim as needing
re-verification against `router.go:456-500`. Doing that re-verification:
**every one of the 10 is registered in the Go router.**

| Operation | Go route (`services/elitea-main/internal/api/router.go`) | In `endpoints.manifest.json`? |
|---|---|---|
| `toolkitCreate` | `POST /tools/prompt_lib/{projectID}` :647 | yes |
| `toolkitEdit` | `PUT`+`PATCH /tool/prompt_lib/{projectID}/{toolkitID}` :649-650 | yes |
| `toolkitTest` | `POST /test_tool/...` :659, `/test_toolkit_tool/...` :660 | yes |
| `toolkitFork` | `POST /fork_toolkit/prompt_lib/{projectID}` :658 | **no** |
| `toolkitExport` | `GET /export_toolkit/...` :661 | **no** |
| `mcpSyncTools` | `POST /mcp_sync_tools/prompt_lib/{projectID}` :886 | **no** |
| `discoverMcpTools` | `POST /toolkit_discover_tools/...` :655 | **no** |
| `validateToolkit` | `GET`+`POST /toolkit_validator/...` :656-657 | **no** |
| `toolkitAvailableTools` | `GET /toolkit_available_tools/...` :654 | **no** |
| `listToolkitTypes` | `GET /toolkit_types/prompt_lib/{projectID}` :653 | **no** |

The handlers exist. The OpenAPI spec / orval client does not cover 7 of them.
That reframes issue #36 from "backend gaps" to "spec + codegen coverage of
handlers that already ship" — much cheaper, and it unblocks the 7
`blocked-codegen` routes without any Go work.

**Correct the comment in `toolkits.ts` as part of this work.** It is load-bearing
misinformation: it is why `CreateToolkit`/`EditToolkit` take an injected `deps`
writer at all.

### Finding 2 — no MCP page gap

`pages/mcps/` holding only `McpAuthCallbackPage.tsx` is correct, not a gap. The
`/mcps` routes are documented as reusing `Toolkits`/`CreateToolkit`/
`EditToolkit` with `isMCP`, and those components branch on `isMCP` throughout
(`Toolkits.tsx:280` names this route family explicitly). Remove this from the
Phase 2 gap list.

### Finding 3 — two settings routes are clean, not hybrids

`/settings/tokens` and `/settings/users` only *mention* `RouteShell` in a
comment ("Replaces the stub `RouteShell` with…"). They are correctly wired. Only
`/settings/secrets` and `/settings/model-configuration` actually stack a shell
heading over real content.

### Finding 4 — `needs-route-state` is the real cost centre

Six routes need props the route layer must own. The heaviest is
`/user-public/:tab` (`tab`, `onTabChange`, `statuses`, `onStatusesChange`,
`authorId`, `authorName`); the credentials family needs `context` +
navigation callbacks; `/settings/secrets` needs the search state that is
currently stubbed to `() => {}`. These are not import swaps and should not be
batched with `ready` routes in the same PR.

## Phase 1 — Wire the routes (bulk of the work)

Batch by **status first, domain second** — Phase 0 showed the three statuses have
very different shapes, and mixing them in one PR would hide the hard rows behind
the easy ones.

**1a — the 22 `ready` routes.** Import swap, props already satisfied. Group as
one PR per domain (artifacts 2, misc 2, apps 3, agents 4, pipelines 3, skills 3,
mcps 1, toolkits 1, user-public 3). Domain order: artifacts → misc → agents →
pipelines → skills → apps → toolkits/mcps → user-public. Start with artifacts:
it also reverts PR #82's stubs, which is the smallest end-to-end proof of the
whole approach.

**1b — the 6 `needs-route-state` routes.** One PR each, not batched:
`/credentials/:tab`, `/credentials/:tab/:credential_uid`,
`/credentials/create-credential`, `/settings/create-configuration`,
`/settings/edit-configuration/:credential_uid`, `/user-public/:tab`. Each needs
the route to own state or callbacks; each deserves its own unit tests.

**1c — the 7 `blocked-codegen` routes.** Operator direction (2026-08-06): these
are **in scope, not deferred** — implement the missing layers rather than
routing around them. Sequence:

1. Add the 7 missing operations to the OpenAPI spec, covering the Go handlers
   that already ship (Finding 1 table). Where a handler's request/response shape
   is under-specified, fix the handler too — backend work is in scope.
2. Regenerate the orval client; verify against `endpoints.manifest.json`.
3. Drop the injected `deps` indirection from `CreateToolkit`/`EditToolkit` —
   it exists only because of the false gap comment.
4. Correct the comment in `features/toolkits/api/toolkits.ts`.
5. Wire `/toolkits/create`, `/toolkits/:tab/:toolkitId`, `/mcps/create`,
   `/mcps/:tab/:mcpId`, `/apps/create`, `/user-public/toolkits/:toolkitId`,
   `/user-public/mcps/:mcpId`.

Do 1c **before** the `ready` batches if any `ready` route turns out to depend on
a regenerated hook; otherwise run it in parallel — it touches spec/codegen and
Go, not the route files.

**Branch hygiene:** merge `origin/main` before starting each phase. Done once at
Phase 0 close (merge `e29bc2a`); main carried only `elitea-sdk` Python changes,
no UI, and the route map was unaffected.

Per route, the change is: import the page, pass the documented props, replace
`component: () => <RouteShell …/>` with the real component. Preserve
`validateSearch`, `beforeLoad` guards, `pendingComponent`/`errorComponent`, and
`ExclusiveOutlet` composition exactly — those are Wave-1 infrastructure and are
correct.

**Constraints that will bite (repo-specific, not optional):**

- `i18next/no-literal-string` is enforced by `.oxlintrc.json` and fires on
  string literals passed to attributes named `label`/`title`/`placeholder`/
  `aria-label`/`alt` at the *call site*.
- `.dependency-cruiser.cjs` layer rules: `src/routes/**` may import `pages/` and
  `processes/`; `pages/` may not import sideways from another `features/` slice.
- Slice public-API export budget: ≤20 exported symbols
  (`scripts/lib/budgets-core.mjs`).
- Deleting a `RouteShell` usage may orphan i18n keys — run the i18n check.

**Verification per PR:**

```bash
cd apps/elitea-web && npm run typecheck && npm run lint && npm run test:unit && npm run theme-gate
```

## Phase 2 — Close the real defects

1. **Hybrid double-`<h1>`.** `/settings/secrets` and
   `/settings/model-configuration` render `RouteShell` *above* the real content,
   emitting a placeholder heading over a working page. Drop the `RouteShell`.
   Audit `/settings/tokens` and `/settings/users` for the same shape.
2. **Dead search.** `src/routes/_shell/settings/secrets.tsx` passes
   `search=""` and `onSearchChange={() => {}}` — the control renders and does
   nothing. Wire it or remove it.
3. **~~MCP page layer~~** — withdrawn, see Phase 0 Finding 2. Not a gap.
4. **`/mode-switch`** is wired to `pages/mode-switch/ModeSwitch.tsx`, which
   renders `<div><h1>Switch Mode</h1></div>` with its toggle behind
   `const enableToggle = false`. A page gap, not a wiring gap — decide whether
   the feature ships or the route goes.
5. **Reconcile the open Wave-2 unit issues** against what wiring reveals:
   #32 (chat-messages), #33 (chat-participants), #25 (settings), #23 (skills),
   #80 (AI-config missing ModelConfiguration layer). Some may already be
   satisfied by built-but-unwired code; others are genuinely unfinished. Update
   or close each with evidence.

## Phase 3 — Re-point the tests

The current suite is coupled to the stubs and must not be left asserting
scaffolding:

- `e2e/journeys/artifacts/artifacts.lifecycle.spec.ts:28` falls back to
  `getByTestId('create-bucket-button')` — a testid that exists only in the stub.
- `src/routes/__tests__/guardsIntegration.test.tsx` and `settingsLayout.test.tsx`
  assert `getByTestId('route-shell')` with `data-route-id`. These are legitimate
  *guard/layout* tests; re-point them at a stable landmark of the real page
  rather than deleting the coverage.
- Once no route renders `RouteShell`, delete `src/routes/-ui/RouteShell.tsx` and
  fail the build if it returns.

Then re-audit the 30 E2E journeys: several were authored against stub markup and
assert less than they appear to. Each journey should assert at least one piece
of state that only the real page can produce.

## Phase 4 — Make it non-recurring (issue #61)

Land the visual-regression suite so an unwired route can never again pass CI.
Follow #61 as written — in particular, baselines are only ever generated inside
`mcr.microsoft.com/playwright:v1.62.0-noble`, never on a developer's macOS host.

Add a cheap structural guard that does not need snapshots: a test asserting
every route in `parity/new-app-routes.json` renders a component from `@/pages`
or an equivalent real composition root. That catches this class of defect in
milliseconds and is worth having independent of #61.

## Phase 5 — Design source of truth

**Re-verified directly via the Figma MCP, 2026-08-06.** The 2026-07-27 finding
holds, and is now confirmed independently rather than inherited:

- `whoami`: seat **View**, plan tier **starter** — matches the recorded quota
  constraint (≈6 MCP calls/month; the Enterprise-only
  `/v1/files/:key/variables/local` route remains unavailable).
- `get_metadata` on `5vWxC85QBhqbzPU30RP7LH`: the document has exactly **one**
  top-level page, `143:16009` ("-- ELITEA - UI -----------------------").
- `get_metadata` on that page: it contains exactly **one** frame, `13366:194340`
  "Cover" — the `AlitA` logomark vector, a "Prompt Library" text layer, and the
  logo group. **No product screens, no components, no screen frames.**

The page *name* suggests a UI file; the *contents* are a cover slide. This file
cannot arbitrate any screen-level design question.

**Consequences:**

1. Baseline N4 (parity with the shipped SPA `apps/elitea-ui` @ `a55f36cf`)
   stands. Phases 1–4 proceed against it unchanged.
2. Two ways to resolve properly, both cheap, either is sufficient:
   - a **file key that actually holds product screens** (this one does not), or
   - **production screenshots of the shipped app**, which the operator has
     offered. These map directly onto N4 and are the better fit for a View-tier
     seat: no quota, no Enterprise endpoint, and they capture exactly the
     baseline the parity manifest already encodes.
3. Recommend the screenshots as the primary source and reserve remaining Figma
   quota for token-level questions, if a real design file surfaces.

Note also `src/features/agents/ui/ToolMenuDropdown.tsx:19,24`: comments record
that the baseline had "pixel-exact Figma tokens" this port does **not**
reproduce. Wiring will not fix that class of drift.

### RESOLVED 2026-08-06 — production screenshots are the source of truth

The operator captured 17 production screens from `next.elitea.ai` covering 14
routes across both colour schemes. Indexed at
`apps/elitea-web/parity/screenshot-index.json`; images and prose notes in
`/Users/Alexander_Kharkevich/tmp/elitea-screenshots/` (`MANIFEST.md`).

**This closes the §4.1 Blocker-1 hue question**, which the decisions doc left
open for want of "design provenance for the light-mode magenta". Production runs
**two** accent hues, switched by colour scheme:

- **dark → cyan/teal** — primary split-button, active tab underline, greeting,
  focused composer ring, send button.
- **light → magenta/lavender** — the same controls, active analytics tab, links.

Both ship. The cyan-as-single-hue hypothesis is **refuted**, and T1's
`brand-hue-map.md` open question should be closed against
`skills-list-empty.light.jpeg` vs `agents-list-empty.dark.jpeg` — the same screen
in both schemes. T1's architecture makes this a one-field data change, so it
costs no code churn, but it must land before Phase 4 baselines are generated or
every light-mode snapshot bakes in the wrong hue.

**Acceptance for Phases 1–4 is now visual, not just structural.** Each wired
route must match its reference shot: shell rail, list-screen header chrome
(title / export / list-grid toggle / search / TAGS rail / author card),
empty-state composition (illustration + title + body + `+ Create` +
`Start Guided Tour`), and the editor pattern (back arrow + title + Save/Cancel
over a single centred ~740px column of collapsible uppercase sections).

**One reference already contradicts shipped code:** production `/artifacts` is a
two-pane bucket browser — BUCKETS tree plus a Name/Type/Size/Last update/Actions
DataGrid, upload/download/delete toolbar, `Buckets: 1  Size: 26.3 KB` footer.
PR #82's stub renders a heading and one button. `pages/artifacts/Artifacts.tsx`
is the component that matches the screenshot.

**Nine capture gaps** are listed in the manifest. The blocking ones are the agent
editor (`/agents/:tab/:agentId`), the pipeline flow editor
(`/pipelines/:tab/:agentId`), the whole credentials domain, `/user-public/:tab`,
and `/settings/{users,secrets}` — four of those are `needs-route-state` routes,
so Phase 1b should not start before they are captured.

---

## Sequencing

Phase 0 blocks everything. Phases 1 and 2.1–2.2 run together per domain.
Phase 3 trails each Phase 1 PR by one domain. Phase 4 starts once ~half of
Phase 1 has landed (enough real screens to snapshot). Phase 5 is a question to
the operator and should be asked on day one.

PR #82 should not merge as-is: it adds new stubs alongside existing
implementations and encodes stub testids into the E2E suite. Either hold it
behind Phase 1 domain 1, or merge it with the artifacts stubs reverted.

## Model allocation

| Phase | Model | Why |
|---|---|---|
| 0 — freeze the map | **Opus 5** | Cross-references three sources and decides what counts as a gap. Everything downstream trusts this; a wrong row costs a whole domain PR. |
| 1 — wiring, domains 1–7 | **Sonnet 5** | Contract is pinned by Phase 0, props are documented, verification is a scripted gate. Volume work with a known shape. |
| 1 — wiring, domains 8–11 | **Opus 5** | agents/pipelines/user-public/settings carry `ExclusiveOutlet` tab composition, version params, shared-component reuse across four route families, and the settings hybrids. Highest interaction density. |
| 2 — real defects | **Opus 5** | Requires judgment about whether an open issue is satisfied by unwired code — the exact inference that produced this plan's premise, and the one most costly to get wrong. |
| 3 — re-point tests | **Opus 5** | Deciding what an assertion *should* be is design work. Sonnet will faithfully re-point a weak assertion to a new selector and keep it weak. |
| 4 — visual regression | **Sonnet 5** | #61 already scopes it; the hard problems (auth, stack bring-up) are solved by #60. Matches that issue's own recommendation. |
| 5 — design SoT | n/a | Operator decision. |

Run each Phase 1 domain as its own session rather than one long run — the
domains are independent, the per-PR gate is scripted, and context stays small.
