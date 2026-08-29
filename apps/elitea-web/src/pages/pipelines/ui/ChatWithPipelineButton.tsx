import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import Button from '@mui/material/Button';

import { useNavigate } from '@tanstack/react-router';

import { conversationApi } from '@/entities/conversation';
import { useAddParticipantMutation } from '@/entities/participant';
import type { ApplicationVersionDetail } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';

/** `ChatBox` truncates a conversation name to 50 characters; match it so the sidebar entry reads the same everywhere. */
const MAX_CONVERSATION_NAME = 50;

export interface ChatWithPipelineButtonProps {
  readonly projectId: string | undefined;
  /** The pipeline's id, as the route carries it. */
  readonly applicationId: string | undefined;
  readonly name: string | undefined;
  /** The version the chat runs — the participant pins it, see the mapping note below. */
  readonly activeVersion: ApplicationVersionDetail | undefined;
  readonly onError: () => void;
}

/**
 * "Chat" — the way to actually TALK to the pipeline being edited. The
 * pipelines twin of `pages/agents/ui/ChatWithAgentButton.tsx` (an
 * independent, same-body local copy — `no-sideways-features`/the layer model
 * forbids importing across a `pages/agents` <-> `pages/pipelines` boundary,
 * the same posture `../useDiscardPipelineChanges.ts` documents in full).
 * Before it, the edit page's own chat pane was a disclosed gap
 * (`../lib/pipelineConfigurationTabGaps.tsx`'s chat slot) and nothing else
 * offered a way in: a pipeline could be authored but never spoken to.
 *
 * One click creates a conversation, attaches the pipeline as a participant,
 * and lands in the real chat surface — the same three steps the chat page's
 * "+" menu performs, addressed from the pipeline's side instead.
 *
 * THE ONE MAPPING DIFFERENCE from the agents twin: a pipeline participant is
 * `entity_name: 'application'` with `entity_settings.agent_type: 'pipeline'`
 * — the resolver treats pipelines as applications behind the `agent_type`
 * discriminator (`features/chat-participants/lib/helpers.ts`'s
 * `buildNonModelParticipant`: `participant.agent_type === 'pipeline'` maps to
 * `ChatParticipantType.Applications`). `entity_settings.version_id` is
 * LOAD-BEARING exactly as for agents — the version join reads that key, and a
 * participant without it answers 422 on every turn. `entity_meta.project_id`
 * must equal the conversation's own project, which is why the page renders
 * this only for a writer (same `isReadOnlyView` gate as the save bar).
 */
/** Everything one click needs, gathered so the callback closes over ONE ref-stable object instead of eleven values (the hook-deps budget is 8). */
interface StartChatInput {
  readonly projectId: string;
  readonly applicationId: string;
  readonly name: string | undefined;
  readonly versionId: string;
  readonly agentType: string;
}

export function ChatWithPipelineButton({ projectId, applicationId, name, activeVersion, onError }: ChatWithPipelineButtonProps): ReactNode {
  const navigate = useNavigate();
  const { mutateAsync: createConversation } = conversationApi.useCreate();
  const { mutateAsync: addParticipants } = useAddParticipantMutation();
  const [isStarting, setIsStarting] = useState(false);

  const versionId = activeVersion?.id;
  const agentType = activeVersion?.agent_type;
  // Memoized (a deviation from the agents twin, which builds this inline):
  // oxlint's exhaustive-deps flags an unmemoized object dependency of the
  // click callback as changing every render.
  const input = useMemo<StartChatInput | undefined>(
    () =>
      projectId !== undefined && applicationId !== undefined && versionId !== undefined
        ? { projectId, applicationId, name, versionId, agentType: agentType ?? 'pipeline' }
        : undefined,
    [projectId, applicationId, name, versionId, agentType],
  );

  const handleClick = useCallback(async () => {
    if (input === undefined || isStarting) return;
    setIsStarting(true);
    try {
      const conversation = await createConversation({
        projectId: input.projectId,
        name: (input.name ?? '').slice(0, MAX_CONVERSATION_NAME) || t('pages.pipelines.chatWithPipeline.defaultName', 'New Chat'),
        is_private: true,
      });
      await addParticipants({
        projectId: input.projectId,
        conversationId: String(conversation.id),
        participants: [
          {
            entity_name: 'application',
            entity_meta: { id: input.applicationId, ...(input.name !== undefined ? { name: input.name } : {}), project_id: input.projectId },
            entity_settings: {
              version_id: input.versionId,
              agent_type: input.agentType,
              variables: [],
              icon_meta: {},
            },
          },
        ],
      });
      // The chat page's participant selection makes the freshly attached
      // pipeline the ACTIVE participant on load, so the first send addresses
      // it — same behaviour the agents twin verified in a browser against the
      // standalone stack. Awaited, so a navigation failure reaches the same
      // error surface as a failed create instead of vanishing into a voided
      // promise.
      await navigate({ to: '/chat/$conversationId', params: { conversationId: String(conversation.id) } });
    } catch {
      onError();
      setIsStarting(false);
    }
  }, [input, isStarting, createConversation, addParticipants, navigate, onError]);

  return (
    <Button
      variant="outlined"
      color="secondary"
      size="small"
      data-testid="chat-with-pipeline-button"
      disabled={input === undefined || isStarting}
      onClick={() => void handleClick()}
    >
      {isStarting
        ? t('pages.pipelines.chatWithPipeline.starting', 'Opening chat…')
        : t('pages.pipelines.chatWithPipeline.label', 'Chat')}
    </Button>
  );
}
