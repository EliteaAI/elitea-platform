import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import { adjustLabel, isSecretField } from '../../../lib/helpers/toolBase.helpers';
import { deriveErrorState, resolveFieldKind, shouldRenderField } from './ToolBaseProperty.kinds';
import { renderFieldByKind } from './ToolBaseProperty.dispatch';
import type { ToolBasePropertyProps } from './ToolBaseProperty.types';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/ToolBase/
 * ToolBaseProperty.jsx` (720 lines) — renders ONE JSON-Schema property as
 * the appropriate form control, dispatching on `schema.type`/`ui_component`/
 * `anyOf`. Split into four files to stay under the §3.5 400-line/12-
 * complexity budgets (the baseline is one 720-line, complexity-113
 * function): this file (prop unpacking, visibility gate, kind dispatch),
 * `ToolBaseProperty.kinds.ts` (pure classification/error-state helpers),
 * `ToolBaseProperty.dispatch.tsx` (the per-kind render functions + lookup
 * table), `ToolBaseProperty.renderers.tsx` (the leaf UI components). A
 * file-organization change only, no behaviour change.
 *
 * **R2 FIX — `uiComponent === 'openapi_spec'` now wired for real by
 * default.** `ToolBaseProperty.dispatch.tsx`'s `renderOpenapiSpec` used to
 * unconditionally return `null` unless a caller supplied a
 * `slots.renderOpenApiSpecField` render-prop — no real caller ever did (the
 * live composition root, `ToolkitForm.hooks.ts`, has no `slots` concept at
 * all), so this was silently blank in production for every OpenAPI
 * toolkit. `ToolkitForm.OpenAPISchemaInput`/`ToolkitForm.OpenAPIActions`
 * (`../ToolOpenAPI/{OpenAPISchemaInput,OpenAPIActions}.tsx`) have since
 * landed intra-slice and are now the DEFAULT, composed exactly like the
 * baseline (`ToolBaseProperty.jsx:230-276`) — `slots.renderOpenApiSpecField`
 * remains available as a caller OVERRIDE (still exercised by this file's own
 * tests).
 *
 * **DISCLOSED REDESIGN, still accurate — the remaining 6 baseline
 * sub-components have no port anywhere in this app, folded into one
 * caller-injected `slots.renderCredentialLikeField` slot that still
 * defaults to blank (a real, disclosed gap, not fixed by R2):**
 *  - `type === 'configuration'` used `CredentialsSelect`
 *    (`features/credentials/ui`) — a genuinely different `features/` slice;
 *    `no-sideways-features` (a real dependency-cruiser-enforced gate, not
 *    just a convention) forbids the import outright, no carve-out. The
 *    component itself now exists (`features/credentials/ui/
 *    CredentialsSelect.tsx`), but wiring it through requires the live
 *    composition root (`ToolkitForm.hooks.ts`/`ToolkitForm.tsx`, out of this
 *    cluster's file scope) to actually construct and pass a
 *    `slots.renderCredentialLikeField` — disclosed, not fixed here.
 *  - `type` in `{llm_model, embedding_model, image_generation_model,
 *    toolkit_reference, agent_reference, pipeline_reference}` each used a
 *    `@/components/*` legacy "smart select" (`LlmModelSelect`,
 *    `EmbeddingModelSelect`, `ImageGenerationModelSelect`, `ToolkitSelect`
 *    x2, `AgentSelect`) — none promoted, none owned by this sub-unit's
 *    mission brief (they belong to whichever domain owns the referenced
 *    entity's picker UI).
 *  All 7 non-openapi cases share one `renderCredentialLikeField` slot
 *  (`CredentialLikeFieldContext`, discriminated by `kind`) rather than 6
 *  separate props, per the §3.5 12-prop budget.
 *
 * Also dropped: `specifiedProjectId` was never actually threaded to this
 * component by `ToolBase.jsx`'s own call sites (verified: neither
 * `ToolBase.jsx`'s nor `ToolSection.jsx`'s `<ToolkitForm.ToolBaseProperty>`
 * JSX passes it) — kept as an always-`undefined`-in-this-tree passthrough
 * inside `credentialContext` for the one caller (the not-yet-landed
 * `ToolkitEditor.jsx`) that might supply it.
 */
// Same "re-export only what's actually reachable" pruning as `ToolBase.tsx`'s
// own re-export (see that file's comment for the full pattern), but NARROWER
// here: `ToolBasePropertyCredentialContext`/`ToolBasePropertyFormState`/
// `ToolBasePropertyProps`/`ToolBasePropertySlots` are all genuinely imported
// from THIS barrel (`./ToolBaseProperty`) by real siblings (`ToolBase.types.ts`,
// `ToolBase.render.tsx`, `ToolBase.effects.ts`, `ToolBase.handlers.ts`,
// `ToolSection.tsx`, `ToolBaseProperty.test.tsx`) — unlike `ToolBase.tsx`'s
// case, pruning those would break real imports, so all four stay. Only
// `ToolBasePropertyField`/`ToolBasePropertyVisibility` have zero consumers
// anywhere outside `ToolBaseProperty.types.ts`'s own `ToolBasePropertyProps`
// field declarations — those two are the ones actually removed.
export type {
  ToolBasePropertyCredentialContext,
  ToolBasePropertyFormState,
  ToolBasePropertyProps,
  ToolBasePropertySlots,
} from './ToolBaseProperty.types';

/** Tiny local port of `apps/elitea-ui/src/[fsd]/shared/lib/hooks/useFieldFocus.hooks.js` (13 lines) — not promoted, not owned by any sibling; too small to justify a separate file. */
function useFieldFocus(): { readonly focusedField: string | undefined; readonly toggleFieldFocus: (field: string | undefined) => void } {
  const [focusedField, setFocusedField] = useState<string | undefined>(undefined);
  const toggleFieldFocus = useCallback((field: string | undefined) => setFocusedField(field), []);
  return { focusedField, toggleFieldFocus };
}

export function ToolBaseProperty({
  field,
  formState,
  settings,
  editField,
  handleInputChange,
  visibility,
  disabled,
  credentialContext,
  slots,
}: ToolBasePropertyProps): ReactNode {
  const { key, schema: rawSchema, required, editFieldRootPath = 'settings' } = field;
  const schema = rawSchema ?? {};
  const { toolErrors, setToolErrors, showValidation, validationErrorMessages } = formState;
  const { showOnlyConfigurationFields = false, showOnlyRequiredFields = false, disableConfigFields = false, noAccordionWrapper = false } =
    visibility ?? {};
  const { focusedField, toggleFieldFocus } = useFieldFocus();

  const buildEditFieldPath = useCallback(
    (fieldKey: string) => (editFieldRootPath ? `${editFieldRootPath}.${fieldKey}` : fieldKey),
    [editFieldRootPath],
  );

  const canRender = shouldRenderField({
    key,
    schema,
    required,
    settings,
    showOnlyConfigurationFields,
    showOnlyRequiredFields,
    disableConfigFields,
  });
  if (!canRender) return null;

  const label = adjustLabel(schema.title || key);
  const { toastError, errorText } = deriveErrorState(toolErrors, key, showValidation, validationErrorMessages);
  const effectiveDisabled = disableConfigFields || Boolean(disabled);
  const isSecret = isSecretField(key, schema.format, schema.secret, schema);
  const kind = resolveFieldKind({ key, schema, isSecret });

  return renderFieldByKind(kind, {
    key,
    schema,
    label,
    required,
    settings,
    editField,
    handleInputChange,
    buildEditFieldPath,
    toastError,
    errorText,
    effectiveDisabled,
    noAccordionWrapper,
    focusedField,
    toggleFieldFocus,
    credentialContext,
    slots,
    setToolErrors,
  });
}
