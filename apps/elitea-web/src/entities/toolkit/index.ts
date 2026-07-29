/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 *
 * The `ToolTypes`/`ToolEvents`/`ToolInitialValues`/`toolIconStaticUrl`/
 * `ConfigurationMode`/`CONFIGURATION_VIEW_OPTIONS`/
 * `configurationDoesNotMatchAnything`/`ToolConfigurationForm`/
 * `toolkitValidationErrors`/`toolkitTypeMenuEntries` block below is the
 * Wave-2 promotion pass's Part 2 (+ part of Part 3) landing — see
 * `model/toolForm.ts`, `model/toolConfigurationMode.ts`,
 * `model/validationStatus.ts`, `model/toolMenu.ts` and
 * `ui/ToolConfigurationForm.tsx` for the full per-symbol provenance. 11 new
 * exports + the 8 that were already here = 19/20 — one slot of deliberate
 * headroom; several more pure helpers exist in those files but are NOT
 * re-exported here yet (intra-slice-only for now) because no concrete
 * cross-slice caller has landed to justify spending the budget on them —
 * see the promotion report for the full list of what was left off.
 *
 * `toolkitValidation` (Wave-2 unit C3): `api/useValidateToolkit.ts` moved
 * here from `features/agents` — it had zero real consumers there and needs
 * to be reachable from BOTH `features/agents` and `features/chat-input`
 * (see that file's own doc comment for the full why). Its 4 symbols
 * (`useValidateToolkit`, `useToolkitValidationInfo`, `buildToolkitValidationKey`,
 * `useToolkitValidationStore`) are bundled into ONE object export — the
 * established convention for spending a single budget slot on a
 * multi-symbol group (matches this file's own header note about pure
 * helpers left off individually) — bringing this barrel to the 20/20 cap
 * exactly; no further top-level exports may be added without retiring one.
 */
import {
  buildToolkitValidationKey,
  useToolkitValidationInfo,
  useToolkitValidationStore,
  useValidateToolkit,
} from './api/useValidateToolkit';

export type { Toolkit, ToolkitAuthor, ToolkitPage, ToolkitTypeSchemaMap } from './model/types';
export { isMcpToolkit, isOnlineToolkit, sortToolkitsByName, toolkitDisplayName } from './model/selectors';

export { ToolEvents, ToolTypes, toolIconStaticUrl } from './model/toolForm';
export { ToolInitialValues } from './model/toolInitialValues';
export { CONFIGURATION_VIEW_OPTIONS, ConfigurationMode, configurationDoesNotMatchAnything } from './model/toolConfigurationMode';
export { toolkitValidationErrors } from './model/validationStatus';
export { toolkitTypeMenuEntries } from './model/toolMenu';
export { ToolConfigurationForm } from './ui/ToolConfigurationForm';
export type { ToolConfigurationFormProps } from './ui/ToolConfigurationForm';

/** `api/useValidateToolkit.ts`'s 4 symbols, bundled — same one-slot-per-group convention as `entities/conversation`'s `conversationApi`. `useValidateToolkit`/`useToolkitValidationInfo` are the hooks; `useToolkitValidationStore` (the shared zustand store) and `buildToolkitValidationKey` (its key builder) are exposed for a sibling feature to read/derive from directly. */
export const toolkitValidation = {
  useValidateToolkit,
  useToolkitValidationInfo,
  useToolkitValidationStore,
  buildToolkitValidationKey,
} as const;
