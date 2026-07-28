import { useCallback, useState } from 'react';

import { useCreateApplicationDraft, type ApplicationDraftInput } from '@/entities/application-form';
import { LATEST_VERSION_NAME } from '@/entities/version';
import type { ApplicationCreatedResponse } from '@/shared/api/generated/model';

import { setFieldValueAtPath } from './pipelineFieldChange';
import type { PipelineDraftValues, PipelineFieldChange } from '../model/types';

/**
 * Owns the create-mode form state `pages/NewChat/PipelineEditor.jsx`'s own
 * `PipelineEditor` component read off `useFormikContext()` (baseline has no
 * local state of its own — a `<Formik>` ancestor, not built by this
 * sub-unit, owned it; baseline's create-mode branch renders `CreateAgentForm
 * entityType="pipeline" showInstructions={false}`, `PipelineEditor.jsx:
 * 517-523`). This app has no Formik (`../model/types.ts`'s own doc
 * comment); `ui/PipelineEditor.tsx` is this app's one consumer of a
 * `values`/`onFieldChange`-shaped create form (mirroring
 * `features/agents/lib/useAgentEditorCreate.ts`'s exact same role for
 * `AgentEditor.tsx`), so it is the natural owner of the state those props
 * would read/write.
 *
 * `agentType: 'pipeline'` is always sent (baseline:
 * `useApplicationInitialValues.jsx`'s pipeline branch,
 * `entities/application-form/model/initialValues.ts`'s own
 * `forPipeline ? 'pipeline' : undefined` — the create-mode equivalent of
 * that same discriminant). `pipelineSettings` is always `{ nodes: [], edges:
 * [] }` on create — a brand-new pipeline has no flow graph yet, matching
 * `useCreateApplicationInitialValues(true)`'s own seed.
 *
 * **`conversation_starters`/`welcome_message` gap, disclosed**, same as
 * `useAgentEditorCreate.ts`'s own doc comment: no live UI for either has
 * landed in this worktree (the baseline's `ConversationStarters.jsx`/
 * `AgentInput.WelcomeMessageInput` panels are `features/agents`-owned and
 * `no-sideways-features` forbids reaching them from here even if they had).
 * Both are always sent empty/unset via this path — a real, disclosed gap,
 * not a silently dropped field.
 */
export function usePipelineEditorCreate(projectId: string | undefined) {
  const [values, setValues] = useState<PipelineDraftValues>(EMPTY_CREATE_VALUES);
  const { create, isCreating, error } = useCreateApplicationDraft(projectId);

  const onFieldChange: PipelineFieldChange = useCallback((path, value) => {
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
        agentType: 'pipeline',
        instructions: versionDetails?.instructions ?? '',
        conversationStarters: [],
        variables: (versionDetails?.variables ?? []).map((variable) => ({ name: variable.name, value: variable.value })),
        meta: { step_limit: versionDetails?.meta?.step_limit ?? 25, internal_tools: [] },
        tags: [...(versionDetails?.tags ?? [])],
        tools: [],
        pipelineSettings: { nodes: [], edges: [] },
      },
    };
    return create(draft);
  }, [values, create]);

  return { values, onFieldChange, submit, isCreating, error };
}

const EMPTY_CREATE_VALUES: PipelineDraftValues = {
  name: '',
  description: '',
  version_details: {
    instructions: '',
    welcome_message: '',
    tags: [],
    variables: [],
    meta: { step_limit: 25 },
  },
};
