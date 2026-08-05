/**
 * Split out of `ApplicationAnswer.tsx` to stay under the file-length budget
 * (§3.5) — the tool-call/thinking-step view: coordinator-level actions
 * render flat via `ActionView`, sub-agent-grouped actions render in
 * `SubAgentAccordion`. A minimal stand-in for the baseline's
 * `ApplicationThinkView` (full streaming-liveness parity is out of scope,
 * see `ApplicationAnswer.tsx`'s module doc).
 */
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import Box from '@mui/material/Box';

import { ActionView } from '../ActionView';
import type { ActionViewProps } from '../ActionView';
import { SubAgentAccordion } from '../sub-agent-section/SubAgentAccordion';

import { convertJsonToString } from '@/shared/lib/json';
import type { ToolActionDraft } from '@/entities/message/lib/toolActions';

import { partitionActionsIntoBlocks } from '../../lib/subAgentGrouping';
import type { SubAgentGroupable } from '../../lib/subAgentGrouping';

/** Loosely-typed defensive read of a `SubAgentGroupable`'s richer runtime fields (id/content/status/toolOutputs/...). */
export function asDraft(action: SubAgentGroupable): ToolActionDraft {
  return action as unknown as ToolActionDraft;
}

export function actionKey(action: SubAgentGroupable, index: number): string {
  const draft = asDraft(action);
  return draft.id || `${draft.type}-${index}`;
}

function deriveActionName(action: SubAgentGroupable): string {
  const draft = asDraft(action);
  return draft.parent_agent_name || draft.original_name || '';
}

function deriveActionInstanceKey(action: SubAgentGroupable): string {
  const draft = asDraft(action);
  return draft.parent_agent_call_id || deriveActionName(action);
}

function toActionViewAction(action: SubAgentGroupable): ActionViewProps['action'] {
  const draft = asDraft(action);
  const toolOutputs = draft.toolOutputs === undefined ? undefined : convertJsonToString(draft.toolOutputs);
  return {
    type: draft.type,
    status: draft.status,
    timestamp: draft.timestamp,
    ...(draft.name !== undefined ? { name: draft.name } : {}),
    ...(draft.content !== undefined ? { content: draft.content } : {}),
    ...(draft.toolInputs !== undefined ? { toolInputs: draft.toolInputs } : {}),
    ...(toolOutputs !== undefined ? { toolOutputs } : {}),
    ...(draft.toolMeta !== undefined ? { toolMeta: draft.toolMeta } : {}),
    ...(draft.isError !== undefined ? { isError: draft.isError } : {}),
  };
}

export function swarmChildContent(action: SubAgentGroupable): string {
  const draft = asDraft(action);
  if (typeof draft.content === 'string' && draft.content) return draft.content;
  if (typeof draft.toolOutputs === 'string') return draft.toolOutputs;
  return draft.toolOutputs !== undefined ? convertJsonToString(draft.toolOutputs) : '';
}

/** @public Props for `ApplicationAnswerThinking`. */
export interface ApplicationAnswerThinkingProps {
  readonly actions: readonly SubAgentGroupable[];
}

export function ApplicationAnswerThinking({ actions }: ApplicationAnswerThinkingProps): ReactNode {
  const blocks = useMemo(
    () =>
      partitionActionsIntoBlocks(actions, {
        deriveName: deriveActionName,
        deriveInstanceKey: deriveActionInstanceKey,
        classifyWrapper: () => null,
      }),
    [actions],
  );
  const coordActions = useMemo(() => blocks.flatMap((block) => (block.kind === 'coord' ? block.actions : [])), [blocks]);

  if (!actions.length) return null;

  return (
    <Box sx={{ mb: 0.5 }}>
      {coordActions.map((action, index) => (
        <ActionView key={actionKey(action, index)} action={toActionViewAction(action)} />
      ))}
      <SubAgentAccordion blocks={blocks} />
    </Box>
  );
}
