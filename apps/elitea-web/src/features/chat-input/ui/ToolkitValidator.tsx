/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/chat/ui/slash-suggestion-list/
 * ToolkitValidator.jsx` — renders nothing, but triggers validation for one
 * toolkit. Skips the API call when validation data already exists in the
 * store so it doesn't re-validate on every render.
 *
 * **Redux -> `entities/toolkit`'s promoted store (per this unit's brief).**
 * The baseline's `useSelector(state => selectorKey in state.chat
 * .toolkitValidationInfo)` becomes a direct `entities/toolkit
 * .toolkitValidation.useToolkitValidationStore` read (see that slice's own
 * doc comment on `useValidateToolkit.ts` for the full promotion story).
 * Reads the store's `infoByKey` map directly (not through
 * `useToolkitValidationInfo`, whose `?? EMPTY_VALIDATION_INFO` fallback
 * collapses "never validated" and "validated, zero errors" into the same
 * `[]` — the baseline's own `hasValidationData` needs to distinguish those
 * two, via `in`).
 *
 * **`useValidateToolkitQuery` injected, not called internally** — mirrors
 * `entities/toolkit`'s own `useValidateToolkit`'s documented real backend
 * gap: no generated endpoint for toolkit validation exists yet (grepped;
 * only `useListToolkits`/`useListToolkitInstances` do). A caller supplies
 * the real query once one exists, matching `entities/application-form`
 * `ApplicationValidator.tsx`'s established `useValidate`-injection
 * precedent for the identical situation.
 *
 * **`UseValidateToolkitQuery` type-derived, not imported by name.**
 * `entities/toolkit/api/useValidateToolkit.ts` exports this type, but
 * `entities/toolkit/index.ts` does not re-export it (that barrel is
 * already at its documented 20/20 §3.5 cap) and depcruise's R-L3 forbids a
 * deep cross-slice import straight to the `api/` file. `Parameters<...>`
 * against the already-public `toolkitValidation.useValidateToolkit`
 * recovers the exact same type without either — the same derive-instead-
 * of-import technique `entities/application-form`'s `ApplicationValidator
 * .tsx` doc comment documents for `ValidateVersionArgs`/`ValidateVersionResult`.
 */
import type { ReactNode } from 'react';

import { toolkitValidation } from '@/entities/toolkit';

/** @public Derived, not imported — see the module doc comment. */
export type UseValidateToolkitQuery = Parameters<typeof toolkitValidation.useValidateToolkit>[0]['useValidateToolkitQuery'];

export interface ToolkitValidatorProps {
  readonly toolkitId: string;
  readonly projectId: string;
  /** Injected rather than called internally — see the module doc comment. */
  readonly useValidateToolkitQuery: UseValidateToolkitQuery;
}

export function ToolkitValidator({ toolkitId, projectId, useValidateToolkitQuery }: ToolkitValidatorProps): ReactNode {
  const key = toolkitValidation.buildToolkitValidationKey(projectId, toolkitId);
  const hasValidationData = toolkitValidation.useToolkitValidationStore((state) => key in state.infoByKey);
  toolkitValidation.useValidateToolkit({ projectId, toolkitId, forceSkip: hasValidationData, useValidateToolkitQuery });
  return null;
}
