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
 *
 * **`meta.internal_tools` default — empty, so the created pipeline can
 * actually take a turn.** An earlier adversarial review read the baseline's
 * `['internal_mcp']` seed as the intended default and made this path match
 * it. That default refuses every turn: the chat query admits a version only
 * when its `meta.internal_tools` is `[]` or `["ask_user"]`
 * (`services/elitea-main/internal/db/queries/agent_chat.sql:359-362`), so a
 * version carrying `internal_mcp` resolves zero rows and the browser gets a
 * 422 on send, and the native runtime rejects any other name outright
 * (`services/elitea-worker-rust/src/agents/internal_tools.rs:47-61`).
 * `DEFAULT_INTERNAL_TOOLS` is therefore empty, agreeing with
 * `entities/application-form/model/initialValues.ts` (which carries the full
 * evidence trail) and with `features/agents/lib/useAgentEditorCreate.ts`, the
 * agent-side mirror of this hook. `resolveInternalTools` still respects an
 * explicit override, so this file's own `onFieldChange(
 * 'version_details.meta.internal_tools', …)` escape hatch keeps working if a
 * future caller wires up the Elitea-MCP-Tools toggle deliberately
 * (`PipelineVersionMeta`'s `[metaKey: string]: unknown` index signature
 * already allows it).
 */
const DEFAULT_INTERNAL_TOOLS: readonly string[] = [];

/**
 * Split out purely so `submit`'s own cyclomatic complexity stays under this
 * codebase's oxlint budget (12) — takes the already-resolved `meta` object
 * (one `?.` at the `submit` call site, same as the existing `step_limit`
 * read) rather than the raw `unknown` value, so the `internal_tools` key
 * lookup's own optional-chain branch is counted against THIS function, not
 * `submit`. See this module's own doc comment for why the default is empty
 * and why an explicit value still wins over it.
 */
function resolveInternalTools(meta: NonNullable<PipelineDraftValues['version_details']>['meta']): readonly string[] {
  const raw = meta?.['internal_tools'];
  if (Array.isArray(raw) && raw.every((entry): entry is string => typeof entry === 'string')) {
    return raw;
  }
  return DEFAULT_INTERNAL_TOOLS;
}

export function usePipelineEditorCreate(projectId: string | undefined) {
  const [values, setValues] = useState<PipelineDraftValues>(EMPTY_CREATE_VALUES);
  const { create, isCreating, error } = useCreateApplicationDraft(projectId);

  const onFieldChange: PipelineFieldChange = useCallback((path, value) => {
    setValues((prev) => setFieldValueAtPath(prev, path, value));
  }, []);

  const submit = useCallback(async (): Promise<ApplicationCreatedResponse | undefined> => {
    const versionDetails = values.version_details;
    // Read once and reused by both `step_limit` and `resolveInternalTools`
    // below — keeps `submit`'s own cyclomatic complexity under this
    // codebase's oxlint budget (12) by collapsing what would otherwise be
    // two separate `versionDetails?.meta` optional-chain branches into one.
    const meta = versionDetails?.meta;
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
        meta: { step_limit: meta?.step_limit ?? 25, internal_tools: resolveInternalTools(meta) },
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
