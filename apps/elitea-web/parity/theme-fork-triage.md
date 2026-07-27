# Theme-fork triage — unit T2 (Wave 0)

**Consumer:** unit T1 (brand tokens). **Canonical source:** `apps/elitea-ui` (spec §4.5).
**Date:** 2026-07-26.

## Sources (read-only, pinned)

| App | Path | Pin | Theme files (LOC) |
|---|---|---|---|
| elitea-ui (canonical) | `/Users/Alexander_Kharkevich/projects/eliteaai/elitea-platform/apps/elitea-ui/src` | `a55f36c` | MainTheme.js 367, lightPalette.js 591, darkPalette.js 590 |
| admin-ui | `/Users/Alexander_Kharkevich/projects/eliteaai/elitea-platform/apps/admin-ui/frontend/src` | `0f9d247` | MainTheme.js 418, lightPalette.js 440, darkPalette.js 436 |
| Maintenance-UI | `/Users/Alexander_Kharkevich/projects/eliteaai/frontends/Maintenance-UI/src` | `296449d` | MainTheme.js 515, lightPalette.js 414, darkPalette.js 411 |

Total: **4,182 LOC** (`wc -l` over the nine files), matching spec §4.1 exactly.

Diff metric used throughout: plain `diff old new` (the format the spec's "195 lines" refers to).
`diff apps/elitea-ui/src/darkPalette.js apps/admin-ui/frontend/src/darkPalette.js | wc -l` → **195**
(unified `diff -u` of the same pair is 336 lines — do not confuse the two metrics).

**Fork topology (measured):** Maintenance-UI's theme files are near-clones of *admin-ui's*
copies, not elitea-ui's (admin↔maint plain-diff sizes: darkPalette 37, lightPalette 43,
MainTheme 165 vs elitea↔maint 230 / 274 / 729). Both non-canonical apps descend from an old
elitea-ui snapshot: admin still carries `background.moderator`, which elitea-ui deleted in
commit `d46cb93` "Feat: [EL-5170] remove moderation space (#337)" (2026-06-15), and still has
the pre-`c1d302e` (EL-4033) value for `border.error`.

Classification legend:
- **(a) default-pack token** — legitimate key/value; enters the default brand pack (elitea-ui value).
- **(b) bug** — accidental divergence: stale copy, dead key, or zero-impact notation drift. Resolution: canonical elitea-ui value/keyset wins; nothing extra for the pack.

---

## 1. Per-line triage — `darkPalette.js`, elitea-ui ↔ admin-ui

The 195-line plain diff decomposes into **162 content lines** (158 elitea-only `<`, 4
admin-only `>`) plus 31 hunk headers and 2 `---` separators. Every content line is classified
below. `E:` = elitea-ui `src/darkPalette.js` line, `A:` = admin-ui
`frontend/src/darkPalette.js` line. Where one leaf value spans several physical lines
(openers/closers/wrapped strings), each physical line is listed and inherits the leaf's
classification; line counts per row are explicit so the totals reconcile.

### 1.1 Hunk `16d15` — 1 line

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:16 | `const whiteStepBorder` | `'#757575'` | absent | **a** | Backs `step.default.border`, consumed at `[fsd]/entities/version/ui/PublishWizardModal.jsx:384`. |

### 1.2 Hunk `37d35` — 1 line

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:37 | `const blue70` | `'rgba(41, 184, 245, 0.70)'` | absent | **a** | Backs `text.linkSeen`, consumed at `[fsd]/entities/notifications/ui/NotificationListItemMessage.jsx:60`. |

### 1.3 Hunk `40,42d37` — 3 lines

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:40 | `const darkBlueLowOpacity` | `'rgba(0, 109, 209, 0.4)'` | absent | **a** | Backs `step.active` / `step.completed.border` (PublishWizardModal.jsx:394,404). |
| E:41 | `const completedBlue` | `'#036ED033'` | absent | **a** | Backs `step.completed.background` (PublishWizardModal.jsx:405). |
| E:42 | `const hoverBlue` | `'#2783D8'` | absent | **a** | Backs `background.button.neutral.hover` (`[fsd]/shared/ui/button/BaseBtn.jsx:174`). |

### 1.4 Hunk `49a45` — 1 line (admin-only)

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| A:45 | `const red20` | absent | `'rgba(215, 22, 22, 0.20)'` | **b** | Only referenced by dead key `background.moderator` (A:212). Moderation space removed from canonical in elitea-ui commit `d46cb93` (EL-5170); `grep -rn moderator apps/admin-ui/frontend/src --include='*.jsx' --include='*.js'` excluding palettes → 0 consumers. Dead const. |

### 1.5 Hunk `60,61d55` — 2 lines

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:60 | `const warningStatus` | `'#E97912'` | absent (admin inlines the literal) | **a** | Backs `status.onModeration`, `icon.fill.warning`; introduced in elitea commit `be1bb86` (EL-4793). |
| E:61 | `const warningStatusTextLight` | `'#FFEBD3'` | absent | **a** | Backs `status.warningText`, consumed at `[fsd]/entities/version/ui/ValidationStep.jsx:41`. |

### 1.6 Hunk `70,72d63` — 3 lines

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:70 | `const greenDefaultBtn` | `'#108D22'` | absent | **a** | Backs `status.publishedIcon` (ValidationStep.jsx:28) and `background.button.positive.*` (BaseBtn.jsx:182-184). |
| E:71 | `const greenHoverBtn` | `'#15A42A'` | absent | **a** | Backs `icon.fill.successModal` (see §1.22) and `button.positive.hover` (BaseBtn.jsx:183). |
| E:72 | `const greenBorder` | `'#2AB37A'` | absent | **a** | Backs `status.publishedBorder` (ValidationStep.jsx:30). |

### 1.7 Hunk `83,86d73` — 4 lines

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:83 | `const darkPurpleBgr` | `'#2A2F46'` | absent | **a** | Backs `capability.vision.background`; consumed via `palette.capability[type].background` at `[fsd]/widgets/llm-model-selector/ui/CapabilityChip.jsx:67`. |
| E:84 | `const darkOrangeBgr` | `'#362F2E'` | absent | **a** | Backs `capability.reasoning.background` (CapabilityChip.jsx:67). |
| E:85 | `const darkPurple` | `'#7C69B4'` | absent | **a** | Backs `capability.vision.icon` (CapabilityChip.jsx:84). |
| E:86 | `const darkOrange` | `'#A5695C'` | absent | **a** | Backs `capability.reasoning.icon` (CapabilityChip.jsx:84). |

### 1.8 Hunk `102,110d88` — 9 lines: `step.*`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:102 | `step: {` (opener) | — | absent | **a** | Group consumed by the publish wizard stepper; all leaves below. |
| E:103 | `step.default` | `{ border: whiteStepBorder, icon: white10 }` | absent | **a** | PublishWizardModal.jsx:384,386. |
| E:104 | `step.active` | `darkBlueLowOpacity` | absent | **a** | PublishWizardModal.jsx:394,396. |
| E:105 | `step.completed: {` (opener) | — | absent | **a** | Leaves below. |
| E:106 | `step.completed.border` | `darkBlueLowOpacity` | absent | **a** | PublishWizardModal.jsx:362,404. |
| E:107 | `step.completed.background` | `completedBlue` | absent | **a** | PublishWizardModal.jsx:405. |
| E:108 | `step.completed.icon` | `darkBlue` | absent | **a** | PublishWizardModal.jsx:407. |
| E:109 | `},` (closes `completed`) | — | absent | **a** | Structural line of the consumed group. |
| E:110 | `},` (closes `step`) | — | absent | **a** | Structural line of the consumed group. |

### 1.9 Hunk `117,119d94` — 3 lines: `background.modal`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:117 | `modal: {` (opener) | — | absent | **a** | Group consumed by BaseModal. |
| E:118 | `background.modal.simple` | `gray50` | absent | **a** | `[fsd]/shared/ui/modal/BaseModal.jsx:171,239`. |
| E:119 | `},` (closes `modal`) | — | absent | **a** | Structural line of the consumed group. |

### 1.10 Hunk `134d108` — 1 line

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:134 | `background.codeMirrorEditor` | `gray55` | absent | **a** | `[fsd]/features/settings/ui/project-context/ProjectContextContent.jsx:367`. |

### 1.11 Hunk `138,192d111` — 55 lines: card gradients, `interactiveTourPrompt`, `resourceCard`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:138 | `background.card.gradientDark` | `'linear-gradient(0deg, #121820 0%, #1D232C 100%)'` | absent | **a** | `utils/cardStyles.js:61`; cardStyles imported by AgentCard.jsx, ApplicationCatalogCard.jsx, ResourceCard.jsx, DataCards.jsx, ConfigurationCard.jsx. |
| E:139 | `background.card.hoverBorderGradient` | `'linear-gradient(0deg, rgba(83, 176, 191, 0.4) 0%, #53B0BF 100%)'` | absent | **a** | `utils/cardStyles.js:28`. |
| E:140 | `background.card.hoverShadow` | `'0px -3px 0.9375rem 0px rgba(120, 230, 255, 0.3)'` | absent | **a** | `utils/cardStyles.js:30`. |
| E:141 | `},` (closes `card` in elitea layout) | — | (admin closes `card` at A:112) | **a** | Structural; diff aligns admin's closer with elitea L193. |
| E:142 | `interactiveTourPrompt: {` (opener) | — | absent | **a** | Group consumed by the interactive-tours feature. |
| E:143 | `…backdrop` | `'rgba(59, 62, 70, 0.5)'` | absent | **a** | `[fsd]/features/interactive-tours/ui/InteractiveTourBackdrop.jsx:20`; InteractiveTourSpotlight.jsx:32,52. |
| E:144 | `…card` | `'linear-gradient(360deg, #122543 0%, #194386 100%)'` | absent | **a** | Consumed by the tour card (feature files above; group access). |
| E:145 | `…borderGradient` | `'linear-gradient(186.77deg, #2773EE 5.31%, #1A3C74 94.69%)'` | absent | **a** | InteractiveTourSpotlight.jsx:65. |
| E:146-147 | `…dividerGradient` (key + wrapped value) | `'linear-gradient(90deg, rgba(38, 112, 232, 0) 0%, #26ABE8 49.7%, rgba(38, 112, 232, 0) 100%)'` | absent | **a** | `[fsd]/features/interactive-tours/ui/TourCardHeader.jsx:56`. (2 physical lines.) |
| E:148 | `…counter` | `'rgba(92, 130, 191, 1)'` | absent | **a** | InteractiveTourCard.jsx:216. |
| E:149 | `},` (closes `interactiveTourPrompt`) | — | absent | **a** | Structural. |
| E:150 | `resourceCard: {` (opener) | — | absent | **a** | Group consumed dynamically: `palette.background.resourceCard?.[colorScheme]` at `[fsd]/pages/resources/ui/ResourceCard.jsx:45,78,87`. |
| E:151-158 | `resourceCard.blue.{card,icon,iconColor,iconBorderGradient,divider,borderGradient}` + opener/closer | 6 gradient/colour leaves (`#0094FF` family) | absent | **a** | ResourceCard.jsx:45 (scheme lookup by colour name). (8 physical lines.) |
| E:159-166 | `resourceCard.orange.*` + opener/closer | 6 leaves (`#F5AD49` family) | absent | **a** | Same consumer. (8 physical lines.) |
| E:167-175 | `resourceCard.purple.*` + opener/closer (`iconBorderGradient` wraps to 2 lines) | 6 leaves (`#A473FF` family) | absent | **a** | Same consumer. (9 physical lines.) |
| E:176-183 | `resourceCard.green.*` + opener/closer | 6 leaves (`#4BBA88` family) | absent | **a** | Same consumer. (8 physical lines.) |
| E:184-192 | `resourceCard.pink.*` + opener/closer (`iconBorderGradient` wraps to 2 lines) | 6 leaves (`#FF73B0` family) | absent | **a** | Same consumer. (9 physical lines.) |

### 1.12 Hunk `217,220d135` — 4 lines: `background.icon.entity*`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:217-218 | `background.icon.entityGradient` (key + wrapped value) | `'linear-gradient(45.36deg, rgba(169, 183, 193, 0.3) 16.25%, rgba(169, 183, 193, 0.09) 87.07%)'` | absent | **a** | `[fsd]/shared/ui/icon/GradientIconWrapper.jsx:25`; `components/EntityIcon.jsx:251`. |
| E:219-220 | `background.icon.entityBorderGradient` (key + wrapped value) | `'linear-gradient(225deg, rgba(156, 169, 178, 0) 12.64%, rgba(156, 169, 178, 0.4) 87.88%)'` | absent | **a** | GradientIconWrapper.jsx:34; EntityIcon.jsx:263. |

### 1.13 Hunk `260,267d174` — 8 lines: `background.button.agentHub`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:260 | `agentHub: {` (opener) | — | absent | **a** | Group consumed by the sidebar Agent-Hub button. |
| E:261 | `…default` | `'rgba(56, 83, 164, 0.2)'` | absent | **a** | `[fsd]/widgets/sidebar-root/ui/button/AgentHubButton.jsx:66`. |
| E:262 | `…hover` | `'rgba(56, 83, 164, 0.2)'` | absent | **a** | AgentHubButton.jsx:81. |
| E:263 | `…active` | `'rgba(56, 83, 164, 0.2)'` | absent | **a** | AgentHubButton.jsx:65. |
| E:264 | `…shadowDefault` | `'0px 0px 10px 0px rgba(102, 209, 255, 0.15) inset'` | absent | **a** | AgentHubButton.jsx:69. |
| E:265 | `…shadowHover` | `'0px 0px 16px 0px rgba(102, 209, 255, 0.4) inset'` | absent | **a** | AgentHubButton.jsx:82. |
| E:266 | `…shadowActive` | `'0px 0px 40px 0px rgba(102, 209, 255, 0.3) inset'` | absent | **a** | AgentHubButton.jsx:68. |
| E:267 | `},` (closes `agentHub`) | — | absent | **a** | Structural. |

### 1.14 Hunk `274,285d180` — 12 lines: `background.button.neutral` / `.positive`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:274 | `neutral: {` (opener) | — | absent | **a** | Group consumed by BaseBtn variant system. |
| E:275 | `…default` | `darkBlue` | absent | **a** | `[fsd]/shared/ui/button/BaseBtn.jsx:173`. |
| E:276 | `…hover` | `hoverBlue` | absent | **a** | BaseBtn.jsx:174. |
| E:277 | `…pressed` | `darkBlue` | absent | **a** | BaseBtn.jsx:175. |
| E:278 | `…disabled` | `gray20` | absent | **a** | BaseBtn.jsx:177. |
| E:279 | `},` (closes `neutral`) | — | absent | **a** | Structural. |
| E:280 | `positive: {` (opener) | — | absent | **a** | Group consumed by BaseBtn. |
| E:281 | `…default` | `greenDefaultBtn` | absent | **a** | BaseBtn.jsx:182. |
| E:282 | `…hover` | `greenHoverBtn` | absent | **a** | BaseBtn.jsx:183. |
| E:283 | `…pressed` | `greenDefaultBtn` | absent | **a** | BaseBtn.jsx:184. |
| E:284 | `…disabled` | `gray20` | absent | **a** | BaseBtn.jsx:186. |
| E:285 | `},` (closes `positive`) | — | absent | **a** | Structural. |

### 1.15 Hunk `298,306d192` — 9 lines: `background.tabs` / `background.tab`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:298 | `tabs: {` (opener) | — | absent | **a** | Consumed by BaseTabs. |
| E:299 | `background.tabs.default` | `primaryDefault` | absent | **a** | `[fsd]/shared/ui/tabs/BaseTabs.jsx:31`. |
| E:300 | `},` (closes `tabs`) | — | absent | **a** | Structural. |
| E:301 | `tab: {` (opener) | — | absent | **a** | Consumed by BaseTab. |
| E:302 | `background.tab.default` | `gray10` | absent | **a** | `[fsd]/shared/ui/tabs/BaseTab.jsx:27`. |
| E:303 | `background.tab.hover` | `primaryPressed` | absent | **a** | BaseTab.jsx:28. |
| E:304 | `background.tab.active` | `primaryDefault` | absent | **a** | BaseTab.jsx:29. |
| E:305 | `background.tab.disabled` | `gray20` | absent | **a** | BaseTab.jsx:30. |
| E:306 | `},` (closes `tab`) | — | absent | **a** | Structural. |

### 1.16 Hunk `325a212` — 1 line (admin-only)

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| A:212 | `background.moderator` | absent | `red20` | **b** | Dead key: removed from canonical by elitea commit `d46cb93` (EL-5170 "remove moderation space", 2026-06-15); zero consumers in admin-ui (`grep -rn moderator` over `frontend/src` excluding palettes → 0). Stale-copy leftover; drop. |

### 1.17 Hunk `386,387d272` — 2 lines

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:386 | `background.settingsPage` | `gray60` | absent | **a** | `[fsd]/pages/settings/index.jsx:245`; ConfigurationsPanel.jsx:220. |
| E:387 | `background.chatContinueBackground` | `white10` | absent | **a** | `[fsd]/features/chat/ui/chat-continue/ChatContinue.jsx:110`. |

### 1.18 Hunk `401d285` — 1 line

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:401 | `border.cardsOutlinesGradient` | `'linear-gradient(0deg, #262B34 0%, #313A48 100%)'` | absent | **a** | `utils/cardStyles.js:13`. |

### 1.19 Hunk `404c288` — 2 lines (changed value)

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:404 | `border.error` | `red40` = `'rgba(215, 22, 22, 0.4)'` | — | **b** | elitea deliberately changed `dangerRed`→`red40` in commit `c1d302e` (EL-4033 "Improve Private Credential Mismatch UX for Shared Toolkits"); consumed at `components/CredentialWarningBanner.jsx:93` and `[fsd]/features/pipelines/flow-editor/ui/state/StateVariableTable.jsx:328`. Canonical value `red40` enters the pack. |
| A:288 | `border.error` | — | `dangerRed` = `'#D71616'` | **b** | Stale pre-EL-4033 value; zero `border.error` consumers in admin-ui (grep → 0), so the stale value has no visual effect there. Superseded by canonical. |

### 1.20 Hunk `425d308` — 1 line

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:425 | `text.error` | `dangerRed` | absent | **a** | `[fsd]/features/settings/ui/project-context/ProjectContextContent.jsx:400`. |

### 1.21 Hunk `475,476d357` — 2 lines

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:475 | `text.linkSeen` | `blue70` | absent | **a** | NotificationListItemMessage.jsx:60. |
| E:476 | `text.highlighted` | `white` | absent | **a** | `[fsd]/shared/ui/markdown/Token.jsx:357`. |

### 1.22 Hunks `487,488d367` / `491d369` / `501d378` — 4 lines: `icon.fill.*`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:487 | `icon.fill.info` | `skyBlue` | absent | **a** | Consumed dynamically: `theme.palette.icon.fill[MODAL_ICON_COLOR_KEYS[typeIcon]]` at `[fsd]/shared/ui/modal/BaseModal.jsx:65` with `info → 'info'` at `[fsd]/shared/lib/constants/modal.constants.js:28`. |
| E:488 | `icon.fill.successModal` | `greenHoverBtn` | absent | **a** | Same consumer; `success → 'successModal'` at modal.constants.js:29. |
| E:491 | `icon.fill.warning` | `warningStatus` | absent | **a** | Same consumer; `warning → 'warning'` at modal.constants.js:27. |
| E:501 | `icon.fill.button` | `white` | absent | **a** | `[fsd]/shared/ui/button/BaseBtn.jsx:499,743,773`. |

### 1.23 Hunk `505d381` — 1 line

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:505 | `icon.tagChip.hover` | `white` | absent | **a** | `[fsd]/shared/ui/select/SingleSelect.jsx:807`; `ComponentsLib/AutoCompleteDropDown.jsx:436`. |

### 1.24 Hunk `510,517d385` — 8 lines: `checkbox` + `radio`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:510 | `checkbox: {` (opener) | — | absent | **a** | Group consumed by BaseCheckbox. |
| E:511 | `checkbox.default` | `gray10` | absent | **a** | `[fsd]/shared/ui/checkbox/BaseCheckbox.jsx:76`. |
| E:512 | `checkbox.hover` | `{ on: gray10, off: white }` | absent | **a** | BaseCheckbox.jsx:82-83. |
| E:513 | `checkbox.active` | `white` | absent | **a** | BaseCheckbox.jsx:77-78. |
| E:514 | `checkbox.mark` | `gray60` | absent | **a** | BaseCheckbox.jsx:79,85,89. |
| E:515 | `checkbox.disabled` | `gray20` | absent | **a** | BaseCheckbox.jsx:88. |
| E:516 | `},` (closes `checkbox`) | — | absent | **a** | Structural. |
| E:517 | `radio` (single line) | `{ default: gray10, hover: { off: white }, active: white, disabled: gray20 }` | absent | **a** | BaseCheckbox.jsx:94-100. |

### 1.25 Hunk `539,540c407` — 3 lines (changed + elitea-only)

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:539 | `status.onModeration` | `warningStatus` (= `'#E97912'`) | — | **b** | Identical resolved value on both sides; the diff line exists only because elitea extracted the literal into a const in commit `be1bb86` (EL-4793). Zero-impact notation drift; single token, no override. |
| A:407 | `status.onModeration` | — | `'#E97912'` (literal) | **b** | Same resolved value as canonical; notation drift only. |
| E:540 | `status.warningText` | `warningStatusTextLight` | absent | **a** | `[fsd]/entities/version/ui/ValidationStep.jsx:41`. |

### 1.26 Hunks `542,545d408` / `547d409` — 5 lines: `status.published*` / `rejectedText`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:542 | `status.publishedIcon` | `greenDefaultBtn` | absent | **a** | ValidationStep.jsx:28. |
| E:543 | `status.publishedBackground` | `green` | absent | **a** | ValidationStep.jsx:31. |
| E:544 | `status.publishedText` | `white` | absent | **a** | ValidationStep.jsx:29. |
| E:545 | `status.publishedBorder` | `greenBorder` | absent | **a** | ValidationStep.jsx:30. |
| E:547 | `status.rejectedText` | `lightRed` | absent | **a** | ValidationStep.jsx:52. |

### 1.27 Hunk `570,571d431` — 2 lines

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:570 | `nodeColors.hitl` | `'#5A3D23'` | absent | **a** | Consumed dynamically at `[fsd]/features/pipelines/flow-editor/lib/helpers/node.helpers.jsx:25-27` (`nodeColors?.[nodeType]`); `PipelineNodeTypes.Hitl = 'hitl'` at `[fsd]/features/pipelines/flow-editor/lib/constants/flowEditor.constants.js:54`. |
| E:571 | (blank line) | `''` | absent | **b** | Whitespace-only diff line inside `nodeColors`; no key, no token impact. |

### 1.28 Hunk `574,587d433` — 14 lines: `scrollbar` + `capability`

| Lines | Key / const | elitea-ui value | admin-ui value | Class | Justification |
|---|---|---|---|---|---|
| E:574 | `scrollbar: {` (opener) | — | absent | **a** | Group consumed by ScrollableContainer. |
| E:575 | `scrollbar.thumb` | `white10` | absent | **a** | `[fsd]/shared/ui/scrollable-container/ScrollableContainer.jsx:62` (used by `[fsd]/features/chat/ui/chat-box/ChatMessageList.jsx`). |
| E:576 | `scrollbar.thumbHover` | `gray10` | absent | **a** | ScrollableContainer.jsx:73. |
| E:577 | `},` (closes `scrollbar`) | — | absent | **a** | Structural. |
| E:578 | `capability: {` (opener) | — | absent | **a** | Group consumed by CapabilityChip. |
| E:579 | `vision: {` (opener) | — | absent | **a** | Structural. |
| E:580 | `capability.vision.background` | `darkPurpleBgr` | absent | **a** | CapabilityChip.jsx:67. |
| E:581 | `capability.vision.icon` | `darkPurple` | absent | **a** | CapabilityChip.jsx:84. |
| E:582 | `},` (closes `vision`) | — | absent | **a** | Structural. |
| E:583 | `reasoning: {` (opener) | — | absent | **a** | Structural. |
| E:584 | `capability.reasoning.background` | `darkOrangeBgr` | absent | **a** | CapabilityChip.jsx:67. |
| E:585 | `capability.reasoning.icon` | `darkOrange` | absent | **a** | CapabilityChip.jsx:84. |
| E:586 | `},` (closes `reasoning`) | — | absent | **a** | Structural. |
| E:587 | `},` (closes `capability`) | — | absent | **a** | Structural. |

### 1.29 Reconciliation

| Bucket | Count |
|---|---|
| Plain-diff total lines | **195** |
| — hunk headers (`NdN`/`NcN`/`NaN`) | 31 |
| — `---` separators | 2 |
| — content lines (`<` + `>`) | **162** (158 `<` + 4 `>`) |
| Classified **(a) default-pack token** | **155** |
| Classified **(b) bug** | **7** (E:404, E:539, E:571; A:45, A:212, A:288, A:407) |
| Unclassified | **0** |
| `NEEDS-HUMAN` | **0** |

Per-row line-count audit for the `<` side: consts 14 (§1.1-1.3, 1.5-1.7) + step 9 + modal 3 +
codeMirrorEditor 1 + §1.11 block 55 + entity 4 + agentHub 8 + neutral/positive 12 + tabs/tab 9
+ settingsPage/chatContinue 2 + cardsOutlinesGradient 1 + border.error 1 + text.error 1 +
linkSeen/highlighted 2 + icon.fill 4 + tagChip.hover 1 + checkbox/radio 8 +
onModeration/warningText 2 + published* 4 + rejectedText 1 + hitl/blank 2 +
scrollbar/capability 14 = **158**. `>` side: 4. Total **162**. ✓

**Net finding:** the admin-ui darkPalette is not a curated variant — it is a **stale, trimmed
snapshot** of an older elitea-ui palette. Not one of the 162 divergent lines is a deliberate
admin-side brand decision. Zero divergences require an admin-specific override in the default
brand pack; T1 can take the elitea-ui keyset verbatim as the dark scheme of the default pack
and delete the admin copy.

---

## 2. Summary triage (per-key) — `lightPalette.js`, elitea-ui ↔ admin-ui

Plain diff: 233 lines. Structure mirrors §1 (the same groups are missing on the admin side,
same consumers apply — palette keys are mode-independent at the call site), plus the following
same-key **value** divergences. `E:` = elitea `src/lightPalette.js`, `A:` = admin
`frontend/src/lightPalette.js`.

### 2.1 Same-key value divergences

| Key | elitea-ui (canonical) | admin-ui | Class | Notes |
|---|---|---|---|---|
| `background.card.hover` (E:136 / A:112) | `white` (`#FFFFFF`) | `blue01` (`rgba(248, 252, 255, 1)`) | **b** | Real value drift; admin has the older tint. Canonical wins; admin has no card-hover consumer. |
| `background.imageAttachment` (E:358 / A:247) | `linear-gradient(0deg, #FFFFFF 0%, rgba(255, 255, 255, 0) 100%)` | `linear-gradient(0deg, #ECECEE 0%, rgba(236, 236, 238, 0) 100%)` | **b** | Real drift, stale admin copy. |
| `background.deprecated` (E:370 / A:259) | `warningStatusText` = `'#D37015'` | `orange10` = `'rgba(211, 112, 21, 1)'` | **b** | **Identical colour** (211,112,21 = D3,70,15); const-name drift only. |
| `border.error` (E:403 / A:289) | `red40` = 40% opacity | `red` = full opacity | **b** | Same EL-4033 lineage as dark (§1.19); admin stale. |
| `text.attention` (E:463 / A:348) | `warningStatusText` (`#D37015`) | `orange10` (same colour) | **b** | Identical colour, notation drift. |
| `text.mcp.loginSuccess` (E:472 / A:357) | `green` = `'#2AB37A'` | `lightGreen` = `'rgba(220, 255, 233, 1)'` | **b** | Admin's light-mode value is the **dark-mode** text colour (near-white green on a white page — unreadable); elitea fixed it. Stale copy. |
| `text.mcp.logout` (E:473 / A:358) | `orange` = `'#F2994A'` | `lightOrange` = `'rgba(255, 235, 211, 1)'` | **b** | Same pattern: admin kept the dark-mode value. |
| `text.link` (E:475 / A:360) | `darkBlue` = `'#006DD1'` | `blue` = `'rgba(41, 184, 245, 1)'` | **b** | Real drift; elitea moved light-mode links to darkBlue. Canonical wins. |
| `status.onModeration` (E:540 / A:410) | `warning` = `'#E97912'` | `'#E97912'` literal | **b** | Identical value; const extraction drift. |
| `const warning` (E:24 / A:26) | `'#E97912'` | `'rgba(233, 121, 18, 1)'` | **b** | Identical colour (233,121,18 = E9,79,12), hex-vs-rgba notation. |
| import line (E:1 / A:1) | imports `{ white }`; local `const darkBlue` (E:71) | imports `{ darkBlue, white }` from darkPalette | **b** | Cosmetic module-shape drift; values identical. |

### 2.2 Keyset divergences (mirror of §1)

- **elitea-only, all (a):** `step.*` (E:101-109), `background.modal.simple` (E:116-118),
  `background.codeMirrorEditor` (E:133), `background.card.{gradientDark,hoverBorderGradient,hoverShadow}`
  (E:137-140), `background.interactiveTourPrompt.*` (E:141-149), `background.resourceCard.*`
  (E:150-191), `background.icon.entity{Gradient,BorderGradient}` (E:216-219),
  `background.button.agentHub.*` (E:259-266), `background.button.{neutral,positive}.*`
  (E:273-284), `background.{tabs,tab}.*` (E:297-305), `background.settingsPage` +
  `chatContinueBackground` (E:385-386), `border.cardsOutlinesGradient` (E:400), `text.error`
  (E:428), `text.linkSeen` + `text.highlighted` (E:476-477), `icon.fill.{warning,info,successModal}`
  (E:490-492), `icon.fill.button` (E:502), `icon.tagChip.hover` (E:506), `checkbox`/`radio`
  (E:511-518), `status.warningText` (E:541), `status.published{Icon,Background,Text,Border}`
  (E:543-546), `status.rejectedText` (E:548), `nodeColors.hitl` (E:572), `scrollbar.*`
  (E:575-578), `capability.*` (E:579-588), and their backing consts (`lightStepBorder` E:53,
  `darkBlue`/`darkBlueLowOpacity`/`darkBlue70`/`completedBlue`/`hoverBlue` E:71-75,
  `greenDefaultBtn`/`greenHoverBtn` E:37-38, `warningStatusText` E:25,
  `lightPurpleBgr`/`lightOrangeBgr`/`lightPurple`/`lightOrange` E:83-86). Consumers are the
  same files cited in §1 (mode-independent access).
- **admin-only, all (b):** `background.moderator: red20` (A:213) + `const red20` (A:18) —
  dead (EL-5170, §1.16); `const lightOrange` (A:24), `const orange10` (A:32), `const lightGreen`
  (A:39) — consts that exist only to back the stale values in §2.1.

---

## 3. Summary triage (per-key) — `MainTheme.js`, elitea-ui ↔ admin-ui

Plain diff: 677 lines. `E:` = elitea `src/MainTheme.js`, `A:` = admin `frontend/src/MainTheme.js`.

| Key | elitea-ui | admin-ui | Class | Notes |
|---|---|---|---|---|
| imports (E:1-15 / A:1-2) | pulls 12 variant/style modules from `shared/ui` + `components` (BaseBtn, BaseCheckbox, textFieldVariants, singleSelectVariants, BaseSwitch, TabGroupButton, BaseTab(s), DataGrid, TreeItem, IconButton, menuListVariants) | self-contained, no design-system imports | **b** | Structural consequence of the trimmed fork, not a theme decision. The new app's `shared/brand/mui-overrides/` (R-T12) supersedes both shapes. |
| `typographyVariants.labelLarge` (E:39-44) | present | absent | **b** | **Dead in canonical too**: 0 consumers outside MainTheme in elitea-ui (`grep -rl labelLarge` excluding MainTheme → 0). Do not carry into the pack. |
| all other `typographyVariants.*` units | rem (`'1rem'`, `'1.5rem'`, …) | px (`'16px'`, `'24px'`, …) | **b** | Numerically identical at the 16px root; rem (canonical) wins — px breaks user font-size scaling. |
| `breakpoints.values.prompt_list_*` ×10 (E:94-103) | present | absent | **a** | Consumed in 5 elitea files, e.g. `[fsd]/features/agent-hub/ui/AgentCategorySection.jsx:33,167`, `ConfigurationCard.jsx:139`. Become density/layout tokens. |
| `MuiButton` (E:119 / A:363-402) | `MuiButtonStyles` imported from `[fsd]/shared/ui/button/BaseBtn.jsx` (full variant system) | inline, simplified (`borderRadius: '28px'`, size Small/Large only) | **b** | Admin's is a hand-trimmed older copy; the canonical variant system supersedes it (admin absorbed per spec G7). |
| `MuiToggleButton`, `MuiTextField`, `MuiIconButton`, `MuiDataGrid`, `MuiTreeItem`, `MuiMenuList`, `MuiMenuItem`, `MuiFormHelperText`, `MuiTabs`, `MuiSwitch` (E:120-187, 275, 306-308) | present | absent | **a** | elitea-only overrides backing the design system; all go into `shared/brand/mui-overrides/`. |
| `MuiDialog` (E:145-155 / A:403-413) | rem units (`'1rem'`, `'0.0625rem'`, `'0 0 1.475rem 0 #FFFFFF0D'`) | px units (`'16px'`, `'1px'`, `'0px 0px 23.6px 0px #FFFFFF0D'`) | **b** | Identical computed values (23.6px = 1.475rem); notation drift. |
| `MuiTab` (E:274 / A:177-188) | `MuiTabStyles` from `[fsd]/shared/ui/tabs/BaseTab.jsx` | inline `.MuiTab-textColorPrimary` / `.Mui-selected` colour override | **b** | Diverged stale fork; canonical tab system supersedes. |
| `MuiChip` (E:217-227 / A:111-131) | `background.avatar` root + `background.eliteaDefault` outlined | **contains `theme.palette.mode === 'dark' ? …` branch** (A:114-116), transparent outlined, extra `deleteIcon` override | **b** | Admin-side rework that violates R-T2 (no mode branches); superseded by token-driven canonical override. |
| `MuiSelect.variants` (E:241) | `eliteaSingleSelectVariants` | absent (styleOverrides identical) | **a** | elitea-only variant set. |
| `MuiRadio` / `MuiCheckbox` (E:300-305 / A:213-279) | variant systems from BaseCheckbox | large inline styleOverrides; references `theme.palette.icon.fill.select` (A:243,248) **which exists in neither admin palette** — silently falls back to `primary.main` | **b** | Stale fork + dead palette reference. Canonical variants + `checkbox`/`radio` palette groups (§1.24) supersede. |
| `MuiInput` (E:126-128 / A:280-287) | `eliteaInputVariants(bodyMedium)` | inline input styleOverride | **b** | Stale trim. |
| `MuiMenu`, `MuiDrawer`, `MuiBadge`, `MuiAutocomplete` | rem units | px units, otherwise identical (`'0.0625rem'`↔`'1px'`, `'0.28125rem'`↔`'4.5px'`, `'0.5rem'`↔`'8px'`) | **b** | Notation drift only. |
| `MuiFormControl`, `MuiCssBaseline`, `MuiAvatar`, `MuiPaper`, `MuiTablePagination`, `MuiAppBar`, `MuiTooltip`, `MuiAlert` | identical on both sides | identical | n/a | Not divergent (listed for completeness of the 30-key surface). Note: `MuiAlert` uses named CSS colours `'green'`/`'red'`/`'orange'` in **both** apps (E:276-298 / A:189-212) — a shared defect that T1's mandatory top-level `palette.error`/`palette.success` roles (spec §4.2) must fix. |
| module shape (A:72-343, A:414) | single inline `components` object | shared `components` const spread into `getDesignTokens` | **b** | Cosmetic structure drift. |

---

## 4. Summary triage (per-key) — Maintenance-UI copies

Maintenance-UI (`/Users/Alexander_Kharkevich/projects/eliteaai/frontends/Maintenance-UI/src`,
14 source files) forked from the **admin-ui lineage**: its palettes differ from admin's by only
37 (dark) / 43 (light) plain-diff lines, versus 230 / 274 against elitea-ui. Everything in §1-§3
therefore applies transitively; the deltas below are Maintenance-specific. `M:` = Maintenance file line.

### 4.1 `darkPalette.js` (admin ↔ maint, per key)

| Key | admin-ui | Maintenance-UI | Class | Notes |
|---|---|---|---|---|
| `const primaryDisabled` (A:2) | present | absent | **b** | Trimmed with the `switch` group below. |
| `background.dragging` (A:96) | `blue10` | absent | **b** | Trim; no drag surface in a splash page. |
| `background.tabButton.{hover,disabled}` (A:127-130) | 4-state group | only `{ active, default }` | **b** | Trim; `tabButton.active` is consumed by maint (MuiBadge in its MainTheme). |
| `background.switch.*` (A:183-192) | present | absent | **b** | Trim. |
| `background.banner.*` (A:269-272) | present | absent | **b** | Trim. |
| `text.groupedTitle`, `text.tabButton`, `text.participant` (A:309-311, 318, 340-342) | present | absent | **b** | Trim. |
| `background.moderator: red20` (M:198) | present | present | **b** | Dead key inherited from the pre-EL-5170 snapshot (§1.16), still present in **both** Maintenance palettes (dark M:198, light M:199). |

### 4.2 `lightPalette.js` (admin ↔ maint, per key)

Same trim pattern (`magentaDisabled`, `dragging`, `tabButton` states, `switch`, `banner`,
`boxShadow.aiAnswer`, `groupedTitle`, `tabButton`, `participant` — all **b**, trims), plus
`const light10`: `'#777A83'` vs `'rgba(119, 122, 131, 1)'` — **identical colour**, notation
drift (**b**). Structurally moot: see §4.3 — Maintenance never builds a light theme.

### 4.3 `MainTheme.js` (admin ↔ maint, per key)

| Key | Divergence | Class | Notes |
|---|---|---|---|
| module export (M:513-515) | Maintenance exports `createTheme(getDesignTokens('dark'))` — a **theme instance hard-pinned to dark** | **b** | Its entire `lightPalette.js` (414 LOC) is dead weight; confirms Maintenance is a fixed-scheme splash target (spec N5/Q10) needing only a pack reference, no scheme machinery. |
| `MuiTextField` (M:490-497) | Maintenance-only variant whose style calls `eliteaTextFieldStyle(theme)` — **an identifier that is never imported or defined anywhere in the repo** (`grep -rn eliteaTextFieldStyle` → only M:494) | **b** | Latent `ReferenceError` if any standard-variant TextField ever renders; currently unreachable (0 TextField usages in Maintenance source). Drop, do not port. |
| `MuiButton` sizes (M:421-487) | Maintenance adds `sizeXs`/`sizeXl` + per-size icon/progress sizing that admin lacks | **b** | Orphaned extension of the stale inline button override; the canonical BaseBtn variant system supersedes it. No Maintenance consumer of `size="xs"`/`"xl"` found. |
| `breakpoints` (M:364-374) | Maintenance **kept** the 10 `prompt_list_*` breakpoints that admin deleted | **b** | Fossil evidence of the shared elitea ancestor; unused in Maintenance. |
| `MuiChip` (M:113-120) | Maintenance kept the **elitea-style** chip (no mode branch) that admin later reworked | **b** | Confirms admin's mode-branch chip (§3) is a post-fork admin edit. |
| comments/whitespace (~60 diff lines) | Maintenance retains tutorial comments (`// Checked state`, `// Your color here`, …) | **b** | Cosmetic only. |

Maintenance palette keys actually consumed (23 distinct `palette.*` paths, e.g.
`background.welcome.*`, `background.onboarding`, `boxShadow.onboarding`,
`icon.fill.magicAssistant`, `text.link`) are all present in the canonical elitea-ui keyset —
Maintenance needs **zero** keys of its own in the default pack.

---

## 5. Counts and verdict

| Metric | Value |
|---|---|
| darkPalette elitea↔admin plain-diff total lines | **195** (spec §4.1 ✓) |
| — content lines classified | **162** |
| — classified **(a) default-pack token** | **155** |
| — classified **(b) bug** | **7** |
| — unclassified | **0** |
| — `NEEDS-HUMAN` | **0** |
| Nine-file LOC total | **4,182** (spec §4.1 ✓) |

**Direction for T1:**
1. The default brand pack's scheme maps take the **elitea-ui keyset and values verbatim** for
   both schemes. No admin-ui or Maintenance-UI divergence earned a per-target override — every
   one is a stale snapshot artifact, a trim of unconsumed keys, or a dead key.
2. Drop outright: `background.moderator` (+`red20` const) from both non-canonical apps
   (EL-5170), `typographyVariants.labelLarge` (dead in canonical), Maintenance's
   `eliteaTextFieldStyle` variant, and Maintenance's `sizeXs`/`sizeXl` button sizes.
3. Fix while tokenising (already mandated by spec §4.2/§4.6): `MuiAlert`'s named-colour
   literals (both apps), admin `MuiChip`'s `palette.mode === 'dark'` branch (R-T2 violation),
   admin `MuiRadio`/`MuiCheckbox`'s dead `icon.fill.select` reference.
4. Spec §4.1 line-number nits (values unchanged): the `mode === 'dark' ? darkPalette :
   lightPalette` ternary is at `MainTheme.js:117` (spec says 114); the `components` map spans
   `MainTheme.js:118-364` (spec says 119-354). Still 30 `Mui*` keys ✓.
