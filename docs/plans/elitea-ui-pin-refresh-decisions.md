# Pin refresh: the decisions that need a name on them

**Status:** awaiting decisions · **Created:** 2026-08-30
**Target baseline:** `apps/elitea-ui` `a55f36cf` (2026-07-08) → `20b23c42` (2026-08-28)

Companion to [unported-features-inventory.md](unported-features-inventory.md) Wave 0.1.
The tooling blockers are fixed and committed. What is left is evidence work, and
the parts below cannot be done mechanically — each changes the parity contract.

## Where the re-anchoring got to

The manifest carries **2223 evidence references across 626 files**. Re-anchoring
was done by CONTENT, not by path: read the cited line in the old baseline, find
that exact line text in the new one. Path-only remapping was rejected because
some relocations are rewrites, not moves (`AIConfiguration.jsx` 82 → 221 lines),
and `parity-manifest --validate` only bounds-checks that a line number exists —
it cannot tell that line 412 no longer holds the cited code.

| Outcome | Refs | Safe to apply? |
|---|---|---|
| Exact line text found, position moved | 1325 | **Yes** — text identical by construction |
| Exact line text found, position unchanged | 713 | Yes, no-op |
| File exists, cited line text gone | 126 | **No** — see below |
| File deleted upstream | 59 (29 items) | **No** — see the successor map |

**91.7% is mechanical and safe. The remaining 185 refs are not**, and they are
not evenly boring: a sample of 20 high-confidence matches turned out to encode
real product drift rather than movement.

> Nothing has been applied. A partial re-anchor cannot be committed on its own —
> the manifest is validated against whichever baseline is pinned, so the
> re-anchor and the pin bump have to land in the same commit.

## Decision 1 — drift found while re-anchoring (12 items)

These lines still exist and still mean the same thing, but the **baseline
changed the behaviour**. Each item's `acceptance` asserts the old wording or
gate, and acceptance is immutability-protected: changing it needs a waiver. So
each is either "elitea-web should follow" (a port task) or "record the
divergence" (a waiver).

| Item | Baseline change |
|---|---|
| PERM-002 | Artifact toolbar gate `PERMISSIONS.artifacts.delete` → `artifacts.create`. **A permission change, not copy** — treat as the highest-risk row here |
| PARAM-039, PARAM-040 | Query param VALUE `?from=model-configuration` → `?from=ai-providers` (3 call sites each) |
| COPY-041 | `INTERNAL TOOLS` → `MODULES` |
| COPY-014 | `Toolkits:` → `Tools:` |
| COPY-089 | Menu label `Internal Tools` → `Modules` |
| COPY-341 | Create-menu label `Configuration` → `AI Provider` |
| COPY-200 | `Other LLM Providers` → `Other Providers` |
| COPY-002 | `New Configuration` → `Configuration` |
| COPY-106 | Voice volume `Mute` → `0%` |
| COPY-381 | `Raw Json view` → `Raw JSON view` |
| COPY-316 | Character-counter gate `isAtLimit` → `showMaxLimitMessage` |

`INTERNAL TOOLS` → `MODULES` and `Toolkits:` → `Tools:` look like one
vocabulary change rolling through the product. If that is a deliberate rename,
it affects far more than these rows and should be handled as its own task.

## Decision 2 — the 19 "deleted" files are a restructure (29 items)

None of these are deletions in the product sense. Every one has a successor, and
the successor is usually a NEW ROUTE — which is why they show up here and in the
new-routes list at the same time. Proposed mapping, needs confirmation:

| Items | Old file | Successor | Note |
|---|---|---|---|
| ACT-097/098/101/102/103/104, COPY-279 | `features/toolkits/ui/test-tools/TestTools.jsx`, `TestToolSettings.jsx` | `pages/toolkit/ToolkitTest.jsx` | Became routes `/toolkits/:tab/:toolkitId/test` **and** `/mcps/:tab/:mcpId/test` (same component) |
| COPY-504 | `pages/UserSettings/components/ProfileLongTermMemory.jsx` | `features/settings/ui/memory/MemoryLongTermMemory.jsx` | Now route `/settings/memory` — **this contradicts the inventory's E3**, see below |
| COPY-506 | `…/ProfileSummarization.jsx` | `…/memory/MemorySummarization.jsx` | route `/settings/memory` |
| COPY-503 | `…/ProfileContextManagement.jsx` | `…/memory/MemoryContextManagement.jsx` | route `/settings/memory` |
| COPY-505, JRNY-029 | `…/ProfilePersonalization.jsx` | `features/settings/ui/preference/` or `…/ai-personality` | **Confirm which** — the baseline split personalization across `/settings/preferences` and `/settings/ai-personality` |
| COPY-507 | `pages/UserSettings/UserSettings.jsx` | `features/settings/ui/profile/Profile.jsx` | route `/settings/profile` |
| ACT-061, COPY-207, COPY-201, COPY-208 | `features/settings/ui/ai-configuration/Configuration/*` | `features/settings/ui/project-general/project-ai-configurations/*` | route renamed `/settings/model-configuration` → `/settings/ai-providers` |
| ACT-052, COPY-254, PERM-030, COPY-255, COPY-257, COPY-259 | `toolkits/indexes/ui/IndexDetails/{IndexActions,IndexConfig,IndexNameWrapper,IndexViewToggler}.jsx` | `…/indexes/ui/index-details/` | Directory renamed; these four components **dissolved** — the successor for each needs a look |
| COPY-253, COPY-511 | `toolkits/indexes/lib/helpers/indexSchedule.helpers.js` | relocated under `indexes/` | COPY-511 already carries a cron-wording waiver |
| COPY-431 | `pages/Applications/Components/Tools/ToolConfigurationForm.jsx` | dissolved into agent tools UI | Needs a look |
| COPY-405 | `components/UnsavedDialog.jsx` | shared dialog, relocated | Needs a look |
| COPY-116 | `features/interactive-tours/lib/constants/agentHubTour.constants.js` | tours restructured with `/elitea-catalog` | Tour system is not ported to elitea-web at all — candidate for a waiver |
| COPY-469 | `pages/ModeSwitch.jsx` | **none** | Upstream deleted the route. elitea-web ships it as verified dead code (`build-route-wiring-map.mjs:130`). The one true retirement — candidate for `status: waived` |

## Decision 3 — 126 refs whose cited line is gone (beyond the 12 above)

Split by how confidently a successor line could be identified:

- **20 confident** (line-similarity ≥ 0.85) — these are Decision 1's rows plus a
  few pure renames.
- **17 need review** (0.70–0.85).
- **67 no match** (< 0.70) — the code was restructured, not edited.
- **22 not distinctive** — the cited line is `<div>`, `>`, `})` and similar.
  These were weak evidence when written; re-pointing them is an opportunity to
  cite something that identifies the behaviour.

Context-window matching was tried and **rejected**: it scored
`aria-label="clear the chat"` against `onClick={onClose}` at 0.83, because the
surrounding lines dominated. Line-only similarity with a distinctiveness guard
is what the numbers above use.

## Correction this forces on the inventory

`unported-features-inventory.md` E3 lists long-term memory as "Coming soon
placard, needs a backend too". That was measured against elitea-web alone. The
baseline **ships it** at `/settings/memory`, with three components
(`MemoryLongTermMemory`, `MemorySummarization`, `MemoryContextManagement`). E3
is therefore an ordinary port gap with a working reference implementation, not
an unknown. The inventory has been corrected.

## What lands when the decisions are made

One atomic commit: pin bump + 1325 re-anchored refs + the resolved 185 + 22 new
ROUTE items + 6 renames + 2 `SYMMETRY_FILLS` + regenerated `default.pack.json`.
Then, separately and through `ci-web-e2e` `workflow_dispatch` only, the visual
baselines — 44 new tokens and 18 changed values, including a materially
different agentHub button.
