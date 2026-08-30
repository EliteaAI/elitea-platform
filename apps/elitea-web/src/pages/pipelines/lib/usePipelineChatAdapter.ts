/**
 * `ConfigurationTab`'s required `adapter`, for real.
 *
 * **THE GAP THIS CLOSES, AND WHY ITS STATED REASON WAS STALE.**
 * `pipelineChat.types.ts`'s `ChatConversationAdapter` doc comment says these
 * four operations have no generated endpoint — "grepping this app's entire
 * generated client for 'conversation' finds zero REST operations". That is
 * still true of the GENERATED client and beside the point: the operations
 * are all handwritten, landed, and already in production use through
 * `entities/conversation`'s own `conversationApi` bundle (unit C1), which is
 * exactly what `ChatWithPipelineButton.tsx` and `widgets/chat-box` call.
 * The placeholder this replaces resolved every method to
 * `{ error: 'not_available' }`, so `usePipelineChat`'s create/delete/stop
 * paths could only ever report failure.
 *
 * `pages/` is the right layer for it: `features/pipelines` may not import
 * `entities/conversation`'s sibling `entities/participant` sideways through
 * a feature, and the adapter parameter exists precisely so the composing
 * page supplies the implementation.
 *
 * SCOPE, HONESTLY. `usePipelineChat`'s own send/stream path is NOT what the
 * editor's chat pane runs — `PipelineTestChat` mounts the real `ChatBox`,
 * which owns its own REST/SSE transport (issue #93). These four methods are
 * therefore reachable today only through `usePipelineChat`'s delete/stop
 * helpers, which nothing in the editor currently calls. They are implemented
 * anyway because a stub that always answers "not available" is a claim about
 * the backend that is false, and because the next caller of
 * `chat.onDeleteMessage`/`onStopAll` should get a working one rather than
 * discover the lie.
 */
import { useMemo } from 'react';

import { conversationApi } from '@/entities/conversation';
import { useAddParticipantMutation } from '@/entities/participant';
import type { ConfigurationTabProps } from '@/features/pipelines';

type ChatConversationAdapter = ConfigurationTabProps['adapter'];
type CreateInput = Parameters<ChatConversationAdapter['createConversation']>[0];
type CreateResult = Awaited<ReturnType<ChatConversationAdapter['createConversation']>>;
type CreatedConversation = NonNullable<CreateResult['data']>;

/** One participant row as the add endpoint reads it — `entities/participant` keeps its own `ParticipantAddInput` off its barrel. */
interface ParticipantRow {
  readonly entity_name: string;
  readonly entity_meta?: Readonly<Record<string, unknown>>;
  readonly entity_settings?: Readonly<Record<string, unknown>>;
}

/**
 * The adapter's `createConversation` promises a conversation that already
 * carries its `id` AND `uuid`; the create route answers with both, but the
 * participants are a SECOND request (`POST .../participants/...`), the same
 * two-step `ChatWithPipelineButton` performs. A conversation whose
 * participants never landed is the one that attaches cleanly and answers 422
 * on every send, so the failure is reported rather than swallowed.
 */
async function createWithParticipants(
  input: CreateInput,
  create: ReturnType<typeof conversationApi.useCreate>['mutateAsync'],
  addParticipants: ReturnType<typeof useAddParticipantMutation>['mutateAsync'],
): Promise<CreateResult> {
  const projectId = input.projectId;
  if (projectId === undefined) return { error: 'missing_project' };
  try {
    const created = await create({ projectId, name: input.name, is_private: input.is_private, meta: input.meta });
    // The caller builds these as its own `Participant` domain rows; the add
    // endpoint reads only the three wire keys off each one, so the boundary
    // is a narrowing cast rather than a claim about the rest of the object.
    const participants = input.participants as unknown as readonly ParticipantRow[];
    if (participants.length > 0) {
      await addParticipants({ projectId, conversationId: String(created.id), participants });
    }
    const data: CreatedConversation = {
      id: created.id,
      uuid: String(created.uuid ?? ''),
      name: created.name,
      source: input.source,
      participants: input.participants,
      chat_history: [],
    };
    return { data };
  } catch (error) {
    return { error };
  }
}

/** The real `ChatConversationAdapter` — one stable object for the page's whole life (`usePipelineChat` closes over it in several dependency arrays). */
export function usePipelineChatAdapter(): ChatConversationAdapter {
  const { mutateAsync: create } = conversationApi.useCreate();
  const { mutateAsync: addParticipants } = useAddParticipantMutation();
  const { mutateAsync: deleteMessage } = conversationApi.useDeleteMessage();
  const { mutateAsync: deleteAllMessages } = conversationApi.useDeleteAllMessages();
  const { mutateAsync: stopTask } = conversationApi.useStopTask();

  return useMemo<ChatConversationAdapter>(
    () => ({
      createConversation: (input) => createWithParticipants(input, create, addParticipants),
      deleteMessage: async ({ projectId, conversationId, id }) => {
        if (projectId === undefined) return { error: 'missing_project' };
        try {
          // `deleted` is the SERVER'S list of the groups it actually removed
          // — one delete can take the answer AND the question it replies to.
          const { deleted } = await deleteMessage({
            projectId,
            id,
            ...(conversationId !== undefined ? { conversationId } : {}),
          });
          return { deleted };
        } catch (error) {
          return { error };
        }
      },
      deleteAllMessages: async ({ projectId, conversationId }) => {
        if (projectId === undefined || conversationId === undefined) return { error: 'missing_conversation' };
        try {
          await deleteAllMessages({ projectId, conversationId });
          return {};
        } catch (error) {
          return { error };
        }
      },
      stopChatTask: async ({ projectId, messageGroupUuid }) => {
        if (projectId === undefined) return;
        // Swallowed deliberately, and ONLY here: the caller's signature is
        // `Promise<void>` — it has nowhere to put a failure — and a stop that
        // the server never saw still has to leave the client's own streaming
        // state torn down.
        try {
          await stopTask({ projectId, messageGroupUuid: String(messageGroupUuid) });
        } catch {
          /* reported nowhere by contract — see above */
        }
      },
    }),
    [create, addParticipants, deleteMessage, deleteAllMessages, stopTask],
  );
}
