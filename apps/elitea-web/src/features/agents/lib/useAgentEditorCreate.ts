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
 */
export function useAgentEditorCreate(projectId: string | undefined) {
  const [values, setValues] = useState<AgentDraftValues>(EMPTY_CREATE_VALUES);
  const { create, isCreating, error } = useCreateApplicationDraft(projectId);

  const onFieldChange: AgentFieldChange = useCallback((path, value) => {
    setValues((prev) => setFieldValueAtPath(prev, path, value));
  }, []);

  const submit = useCallback(async (): Promise<ApplicationCreatedResponse | undefined> => {
    const versionDetails = values.version_details;
    const draft: ApplicationDraftInput = {
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
    return create(draft);
  }, [values, create]);

  return { values, onFieldChange, submit, isCreating, error };
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
