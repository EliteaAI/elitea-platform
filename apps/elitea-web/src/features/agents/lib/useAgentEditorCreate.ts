import { useCallback, useState } from 'react';

import { useCreateApplicationDraft, type ApplicationDraftInput } from '@/entities/application-form';
import { LATEST_VERSION_NAME } from '@/entities/version';
import type { ApplicationCreatedResponse } from '@/shared/api/generated/model';

import { setFieldValueAtPath } from './agentFieldChange';
import type { AgentDraftValues, AgentFieldChange } from '../model/types';

/**
 * Owns the create-mode form state `pages/NewChat/AgentEditor.jsx`'s own
 * `AgentEditor` component read off `useFormikContext()` (baseline has no
 * local state of its own for this — a `<Formik>` ancestor, not built by
 * this sub-unit, owned it). This app has no Formik (see
 * `../model/types.ts`'s own doc comment); `AgentEditor.tsx` is this app's
 * one real consumer of `../ui/CreateAgentForm.tsx`'s `values`/
 * `onFieldChange` contract for the CREATE path, so it is the natural owner
 * of the state those props read/write.
 *
 * **`conversation_starters` gap, disclosed:** `AgentVersionDetails`
 * (`../model/types.ts`) carries no `conversation_starters` field — matches
 * `CreateAgentForm.tsx`'s own doc comment: its `conversationStartersSlot`
 * (the baseline's `ConversationStarters.jsx`) has not landed in this
 * worktree either, so there is no live UI to source a value from yet. The
 * created agent's `conversation_starters` is therefore always `[]` via
 * this path today — a real, disclosed gap, not a silently dropped field.
 *
 * **`isDirty`/`reset`:** the baseline's ambient Formik ancestor gave
 * `AgentEditor.jsx` both "has anything changed" (`formik.dirty`, read
 * implicitly by whatever consumed its own local `isDirty` state) and
 * "restore the mounted form to its initial values" (`handleDiscard`,
 * `AgentEditor.jsx:270-273`) for free, for whichever form happened to be
 * mounted — including the create-mode `CreateAgentForm`. Since this hook is
 * the one place CREATE-mode values actually live in this app (no ambient
 * form context — see this file's own doc comment above), it is the only
 * place that can answer either question for create mode: `isDirty` is a
 * plain "has `onFieldChange` ever fired since the last successful create or
 * reset" flag (not a deep-equal diff against `EMPTY_CREATE_VALUES` — the
 * `AgentEditor.tsx` caller's `handleDiscard` doc comment). `reset` restores
 * `values` to `EMPTY_CREATE_VALUES` — CREATE mode's initial values are
 * always this fixed constant (never derived from existing agent data, same
 * as the baseline's own `createInitialValues`), so "discard" and "start a
 * fresh create form" are the identical operation.
 */
export function useAgentEditorCreate(projectId: string | undefined) {
  const [values, setValues] = useState<AgentDraftValues>(EMPTY_CREATE_VALUES);
  const [isDirty, setIsDirty] = useState(false);
  const { create, isCreating, error } = useCreateApplicationDraft(projectId);

  const onFieldChange: AgentFieldChange = useCallback((path, value) => {
    setValues((prev) => setFieldValueAtPath(prev, path, value));
    setIsDirty(true);
  }, []);

  const reset = useCallback(() => {
    setValues(EMPTY_CREATE_VALUES);
    setIsDirty(false);
  }, []);

  const submit = useCallback(async (): Promise<ApplicationCreatedResponse | undefined> => {
    const result = await create(buildCreateDraft(values));
    if (result) setIsDirty(false);
    return result;
  }, [values, create]);

  return { values, onFieldChange, submit, isCreating, error, isDirty, reset };
}

const EMPTY_CREATE_VALUES: AgentDraftValues = {
  name: '',
  description: '',
  version_details: {
    instructions: '',
    welcome_message: '',
    tags: [],
    variables: [],
    tools: [],
    meta: { step_limit: 25 },
  },
};

/** `submit`'s request-body construction, extracted purely to keep `useAgentEditorCreate` under the oxlint complexity budget. */
function buildCreateDraft(values: AgentDraftValues): ApplicationDraftInput {
  const versionDetails = values.version_details;
  return {
    name: (values.name ?? '').trim(),
    description: values.description ?? '',
    type: 'interface',
    version: {
      name: LATEST_VERSION_NAME,
      agentType: undefined,
      instructions: versionDetails?.instructions ?? '',
      // `welcome_message` is deliberately NOT sent: `ApplicationVersionDraft`
      // (entities/application-form/model/initialValues.ts) has no field for
      // it — see `useAgentDraftApproval.ts`'s doc comment for the identical,
      // already-disclosed gap on the generate-with-AI create path.
      conversationStarters: [],
      variables: (versionDetails?.variables ?? []).map((variable) => ({ name: variable.name, value: variable.value })),
      meta: { step_limit: versionDetails?.meta?.step_limit ?? 25, internal_tools: [] },
      tags: [...(versionDetails?.tags ?? [])],
      tools: [],
      pipelineSettings: undefined,
    },
  };
}
