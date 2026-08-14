import { useCallback } from 'react';

import type { CredentialLikeFieldContext, CredentialLikeFieldKind } from '../ToolBase/types';
import type { ToolBaseSlots } from '../ToolBase/ToolBase.types';
import { ModelSelectField } from '../ToolBase/ModelSelectField';
import type { ToolkitModelSection } from '../../../api/toolkitChatSession';

/**
 * #308 — the missing supplier for `ToolBase`'s
 * `slots.renderCredentialLikeField`.
 *
 * `ToolBaseProperty.dispatch.tsx`'s `renderCredentialLike` opens with
 * `if (!ctx.slots?.renderCredentialLikeField || …) return null`, and NOTHING
 * in the tree supplied that slot: every field whose schema type is one of the
 * seven credential-like kinds rendered as empty space. That is not a
 * theoretical gap — `features/toolkits/lib/helpers/toolkitSchema.helpers.ts`
 * retypes any property named `embedding_model` (or annotated
 * `configuration_model: 'embedding'`) to `type: 'embedding_model'`, and the
 * Go type catalogue serves exactly such a property on the `artifact` toolkit
 * (`internal/api/v2/toolkits/handler.go:162`), so an artifact toolkit's
 * embedding-model field was blank on screen with nothing to click.
 *
 * Supplied from `ToolkitForm` (this slice's own composition root for the
 * form) rather than from each page: the field kinds are a property of the
 * toolkit SCHEMA, so every renderer of that schema needs the same behaviour,
 * and threading it through `pages/toolkits/EditToolkit.tsx` +
 * `pages/toolkits/CreateToolkit.tsx` separately is two chances to forget it —
 * which is the shape of the original defect. A caller-supplied
 * `slots.renderCredentialLikeField` still wins (see the merge in
 * `ToolkitForm.hooks.ts`).
 *
 * **Deliberately NOT covered here, and still rendering `null`:**
 *  - `configuration` (the credential picker). `features/credentials`'
 *    `CredentialsSelect` exists and is exported, but `no-sideways-features`
 *    forbids importing it from this slice, so its supplier must be a
 *    page/widget root. It is also NOT reachable today: the kind is assigned
 *    only to properties whose schema `$ref`s a `$defs` entry
 *    (`toolkitSchema.helpers.ts`'s `configProps`), and the Go catalogue
 *    serves no `$defs` at all (measured: zero occurrences in
 *    `internal/api/v2/toolkits/handler.go`). Wiring it would be another
 *    component with no reachable call site.
 *  - `toolkit_reference` / `agent_reference` / `pipeline_reference`. The
 *    baseline's `ToolkitSelect`/`AgentSelect` have no port anywhere in this
 *    app, and the annotations that produce these kinds (`toolkit_types`,
 *    `agent_tags`, `pipeline_tags`) are likewise absent from the Go
 *    catalogue. Building those pickers is a feature, not a wiring fix.
 */
const MODEL_SECTIONS: Partial<Record<CredentialLikeFieldKind, ToolkitModelSection>> = {
  llm_model: 'llm',
  embedding_model: 'embedding',
  image_generation_model: 'image_generation',
};

export function useCredentialLikeFieldSlot(
  projectId: string | undefined,
): NonNullable<ToolBaseSlots['renderCredentialLikeField']> {
  return useCallback(
    (context: CredentialLikeFieldContext) => {
      const section = MODEL_SECTIONS[context.kind];
      if (section === undefined) return null;
      return (
        <ModelSelectField
          section={section}
          // The baseline passes `specifiedProjectId` to each model select and
          // falls back to the selected project; `ToolBase` only sets it for
          // fields rendered in another project's context (a shared toolkit).
          projectId={context.specifiedProjectId === undefined ? projectId : String(context.specifiedProjectId)}
          label={context.label}
          value={context.value}
          onChange={context.onChange}
          required={context.required}
          disabled={context.disabled}
          error={context.error}
          helperText={context.helperText}
        />
      );
    },
    [projectId],
  );
}
