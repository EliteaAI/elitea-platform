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
 * **DISCLOSED REDESIGN — 8 baseline sub-components have no port in this
 * worktree, folded into two caller-injected slots (`slots.
 * renderOpenApiSpecField`/`slots.renderCredentialLikeField`):**
 *  - `uiComponent === 'openapi_spec'` (`ToolBaseProperty.jsx:231-276`)
 *    composed TWO not-yet-landed intra-slice siblings (`ToolkitForm.
 *    OpenAPISchemaInput`/`ToolkitForm.OpenAPIActions`) — R-L3 intra-slice
 *    imports are legal even before the sibling lands, but importing a file
 *    that does not exist yet breaks THIS unit's own build, so both are
 *    delegated as one `renderOpenApiSpecField` slot instead (`OpenApiSpecFieldContext`,
 *    `types.ts`), matching `AgentEditor.tsx`'s established
 *    not-yet-landed-sibling precedent.
 *  - `type === 'configuration'` used `CredentialsSelect`
 *    (`features/credentials/ui`) — a genuinely different `features/` slice;
 *    `no-sideways-features` forbids the import outright, no carve-out.
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
