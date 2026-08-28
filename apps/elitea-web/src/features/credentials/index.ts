/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20
 * exported symbols, enforced by `scripts/check-budgets.mjs`).
 *
 * `CredentialWarning` (A7-api-model adversarial-review fix, consolidating
 * an A7-ui pass that landed moments earlier in the same file): the
 * credential-change-warning hook, modal, and banner
 * (`useCredentialWarningModal`, `CredentialWarningModal`,
 * `CredentialWarningBanner`) were fully built and tested but reachable only
 * as two separate flat exports (hook + modal), because a third flat export
 * for the banner would have pushed this barrel to 21/20
 * (`scripts/lib/budgets-core.mjs`'s `countExports` counts each named
 * specifier; see that file for the exact rule) — the prior version of this
 * comment recorded that as a dead end ("budget: 20/20, zero room left").
 * It isn't: the three are ONE cohesive unit in the baseline too (a single
 * `entities/credential-warning` slice — `hooks/`, `ui/`, `helpers/` all
 * under it), always consumed together (the hook's `showWarning` drives the
 * modal's `open`; the banner is the inline sibling for the "no matching
 * credential" case the same flow can hit). Exporting them as ONE grouped
 * object, `CredentialWarning: { useModal, Modal, Banner }`, costs exactly 1
 * export slot instead of 3 and gets the banner reachable too — the §3.5
 * "bundle related exports into an object instead of gaming the budget
 * checker" resolution, applied to the slice-barrel row instead of the
 * component-props/hook-deps rows it's usually invoked for. Their prop/param
 * TYPES (`CredentialWarningModalProps`, `CredentialWarningBannerProps`,
 * `UseCredentialWarningModalParams`, `UseCredentialWarningModalResult`,
 * `ToolDetailLike`) are deliberately NOT re-exported here for the same
 * budget reason — a caller passing an object literal to
 * `CredentialWarning.useModal(...)` or JSX props to
 * `CredentialWarning.Modal`/`.Banner` gets full structural type-checking
 * against the real signatures without needing to name the types.
 *
 * ROUTING NOTE for whoever wires this up (outside A7-api-model's file
 * scope — do not fold this into this cluster's own fix):
 * `features/toolkits` cannot import this slice directly
 * (`no-sideways-features`/R-L1 — sibling `features/*` never import each
 * other) and already proved that out by hand-porting an equivalent
 * `useCredentialWarning`/`CredentialWarningModal` pair locally
 * (`features/toolkits/model/useCredentialWarning.hooks.ts` +
 * `features/toolkits/ui/form/ToolkitForm/CredentialWarningModal.tsx`), live
 * and wired via `ToolkitsOperationButtons.tsx` for the standalone
 * `pages/toolkits/{Create,Edit}Toolkit.tsx` flows — `features/agents/ui/
 * ToolCard.types.ts` independently hit the same wall for the banner's
 * "credential not found" case (its own doc comment: "which this slice
 * cannot import"). The one toolkit-editing path NOT covered by the
 * toolkits-local port is the chat-mounted editor:
 * `processes/chat/ui/ChatWithEditors.tsx` renders `<ToolkitEditor deps={{
 * renderShell, createToolkit, saveToolkit }}>` with no `checkBeforeSave`
 * entry, so `ToolkitEditorParts.tsx`'s `onBeforeSave={deps.checkBeforeSave}`
 * is `undefined` there and the credential-change warning is silently
 * skipped end-to-end for that flow (matches `ToolkitEditor.tsx`'s own
 * documented no-op default for an omitted `checkBeforeSave`, but the
 * omission was never meant to be permanent — that file's own
 * `deps.checkBeforeSave` doc paragraph names this exact export as the
 * blocker). `processes/chat/ui/` sits ABOVE both `features/toolkits` and
 * `features/credentials` in `.dependency-cruiser.cjs`'s `LAYERS_ABOVE`
 * table (only `src/app/` is barred from importing `processes/`), so it is
 * the correct — and only currently legal — place to import
 * `CredentialWarning` from `@/features/credentials`, call
 * `CredentialWarning.useModal({...})` there, thread its `checkBeforeSave`
 * into that `deps` object, and render `<CredentialWarning.Modal
 * open={showWarning} ... />` alongside the other editor modals already in
 * that file.
 *
 * `CredentialsSelect` (exported below) has its own separate "zero live call
 * site" status for the same `no-sideways-features` reason (A7-ui cluster) —
 * see that file's own doc comment for the full routing writeup; nothing
 * about its barrel export needed to change here.
 */
import { useCredentialWarningModal } from './model/useCredentialWarningModal';
import { CredentialWarningBanner } from './ui/CredentialWarningBanner';
import { CredentialWarningModal } from './ui/CredentialWarningModal';

export type {
  ConfigSchemaNode,
  ConfigSchemaSection,
  ConfigSchemaSubsection,
  ConfigurationTypeDescriptor,
} from './api/configurations';
export {
  useAvailableConfigurationsType,
  useConfigurationDetail,
  useConfigurationsList,
  useCreateConfiguration,
  useDeleteConfiguration,
  useTestConfigurationConnection,
  useUpdateConfiguration,
} from './api/useConfigurations';
export { classifySchemaField, initialDataForSchema } from './lib/schemaField';
export { extractInformationFromCredentialError } from './lib/credentialError';
export { generateCredentialTagList } from './lib/credentialTags';
export { normalizeCredentialPage } from './lib/normalizeCredential';
export { useCredentialValidation } from './model/useCredentialValidation';
export { CredentialsControls } from './ui/CredentialsControls';
export { CredentialsSelect } from './ui/CredentialsSelect';
export { CredentialsTabBar } from './ui/CredentialsTabBar';

/** See this file's own doc comment above for why these three are grouped into one export instead of three. */
export const CredentialWarning = {
  useModal: useCredentialWarningModal,
  Modal: CredentialWarningModal,
  Banner: CredentialWarningBanner,
} as const;
