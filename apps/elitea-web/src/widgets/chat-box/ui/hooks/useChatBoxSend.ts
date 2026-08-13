/**
 * useChatBoxSend — everything `sendQuestion` needs, assembled off widget state.
 *
 * Two jobs that only exist to serve one send:
 *
 *  1. The transport swap (issue #93): bind `features/chat-messages`'s
 *     `useChatStreamTransport` to this widget's live participant roster and
 *     the project/contract identity the Go agent-execution route requires.
 *  2. The two send-time adapters — create-the-conversation-first and
 *     upload-attachments-first — that `sendQuestion` calls before starting a
 *     run at all.
 *
 * A hook of its own rather than a block inside `ChatBox.tsx` because that file
 * and `ChatBox.helpers.ts` both sit exactly on the 400-line budget — the same
 * reason the other nine `useChatBox*` hooks exist.
 */
import { useCallback } from 'react';

import { useChatStreamTransport, type ChatMessage, type ChatStreamContext } from '@/features/chat-messages';
import { conversationApi } from '@/entities/conversation';
import { useAddParticipantMutation } from '@/entities/participant';
// Deep, still-legal import: `UploadedAttachment` is deliberately not on the
// entities barrel (its 20 slots are exactly spent — see that file's own note
// naming this exact path).
import type { UploadAttachmentsOutcome, UploadAttachmentsParams } from '@/entities/conversation/lib/hooks/useUploadAttachments';
import { getConfig } from '@/shared/config';
import { t } from '@/shared/i18n';

import { pickIdAndUuid } from '../ChatBox.helpers';

/** The conversation-lifecycle and attachment-upload slices this hook adapts. */
interface SendDeps {
  readonly createConversation: (input: { name: string; isPrivate: boolean }) => Promise<{ readonly id?: string | number; readonly uuid?: string } | undefined>;
  readonly uploadAttachments: (input: UploadAttachmentsParams) => Promise<UploadAttachmentsOutcome>;
}

/**
 * The agent-execution start body.
 *
 * The REST contract is NOT the socket payload: `chat_predict` carries a flat
 * `question`, while the route reads `payload.user_input`, its own
 * `interaction_uuid`, and `llm_settings` — and answers a flat
 * `400 Invalid agent execution request` when any of that is missing, naming
 * nothing. `question_id` and `interaction_uuid` must both be REAL uuids: the
 * repository parses them before querying and rejects the turn identically for
 * a malformed one as for an absent one.
 */
function buildStartBody(params: {
  readonly conversationUuid: string;
  readonly projectId: string | undefined;
  readonly payload: Record<string, unknown>;
  readonly llmSettings: Readonly<Record<string, unknown>> | undefined;
  readonly modelName: string | undefined;
}): Record<string, unknown> {
  const { payload } = params;
  const question = typeof payload['question'] === 'string' ? payload['question'] : '';
  const participantId = payload['participant_id'];
  return {
    project_id: params.projectId,
    conversation_uuid: params.conversationUuid,
    // 0 is the ad-hoc "no specific participant" value the backend smoke uses;
    // a missing key is rejected rather than defaulted.
    participant_id: participantId ?? 0,
    question_id: payload['question_id'],
    interaction_uuid: crypto.randomUUID(),
    payload: { user_input: question, ...(payload['attachments'] ? { attachments: payload['attachments'] } : {}) },
    llm_settings: {
      ...params.llmSettings,
      ...(params.modelName !== undefined ? { model_name: params.modelName } : {}),
      stream: true,
    },
  };
}

/**
 * The two participants an ad-hoc (plain model) turn resolves against.
 *
 * `ResolveCurrentAdhocTurn` joins on BOTH an `entity_name='user'` participant
 * whose `entity_meta.id` is the actor AND an `entity_name='dummy'` one carrying
 * the model — missing either resolves to no rows and the route answers
 * `422 unsupported_agent_execution`, which names neither (#292, and the same
 * opacity #288 is about). The backend smoke creates exactly this pair before
 * every turn it drives; the UI created neither, so a conversation opened from
 * the chat page could never run.
 *
 * NOTE the id: participants are addressed by the conversation's NUMERIC id
 * while the start route takes its UUID. Passing the wrong one is a bare 500.
 */
function adhocParticipants(input: {
  readonly userId: string | undefined;
  readonly modelName: string;
  readonly llmSettings: Readonly<Record<string, unknown>> | undefined;
}): { readonly entity_name: string; readonly entity_meta?: Record<string, unknown>; readonly entity_settings?: Record<string, unknown> }[] {
  const llmSettings = { ...input.llmSettings, model_name: input.modelName, stream: true };
  return [
    ...(input.userId !== undefined ? [{ entity_name: 'user', entity_meta: { id: Number(input.userId) } }] : []),
    { entity_name: 'dummy', entity_meta: { name: input.modelName }, entity_settings: { llm_settings: llmSettings } },
  ];
}

/** @public Params for `useChatBoxSend`. */
export interface UseChatBoxSendParams {
  readonly deps: SendDeps;
  /** Model settings the composer resolved; forwarded as the turn's `llm_settings`. */
  readonly llmSettings?: Readonly<Record<string, unknown>> | undefined;
  /**
   * The selected model. Passed as the object rather than a pre-read name so the
   * optional chain lives here — reading it at the ChatBox call site pushed that
   * component over its complexity budget.
   */
  readonly model?: { readonly name?: string | undefined } | null | undefined;
  readonly setChatHistory: (updater: (prev: readonly ChatMessage[]) => readonly ChatMessage[]) => void;
  readonly projectId: string | number | undefined;
  readonly projectIdString: string | undefined;
  /** An agent-app conversation takes a different execution contract from an ad-hoc/test one. */
  readonly isAgentsPage?: boolean | undefined;
  /** The signed-in user, for the ad-hoc turn's `user` participant. */
  readonly userId?: string | undefined;
  readonly activeParticipant?: unknown;
  readonly participants?: readonly unknown[] | undefined;
  readonly userName?: string | undefined;
  readonly userAvatar?: string | undefined;
}

/** @public */
export interface UseChatBoxSendResult {
  /**
   * Start the run over REST and subscribe to its stream. `true` ⇒ this
   * transport owns the run and `chat_predict` must NOT also be emitted.
   */
  readonly startStreamedExecution: (params: {
    readonly conversationUuid: string;
    readonly payload: Record<string, unknown>;
  }) => Promise<boolean>;
  readonly isStreaming: boolean;
  readonly createConversationForSend: (question: string) => Promise<{ readonly id?: string | number; readonly uuid?: string } | undefined>;
  readonly uploadAttachmentsForSend: (
    conversationId: string | number,
    files: readonly File[],
  ) => Promise<{ readonly success: boolean; readonly uploaded: UploadAttachmentsOutcome['uploaded'] }>;
}

/**
 * The identity the reducer needs for messages it has to create.
 *
 * The baseline read all of this off refs (`participantsRef`,
 * `activeParticipantRef`). A pure reducer takes it as a value, so this is
 * where the widget's live participant state crosses that boundary.
 */
function buildChatStreamContext(params: UseChatBoxSendParams): ChatStreamContext {
  const participantId = (params.activeParticipant as { id?: string | number } | undefined)?.id;
  return {
    ...(participantId !== undefined ? { participantId: String(participantId) } : {}),
    ...(params.userName !== undefined ? { name: params.userName } : {}),
    ...(params.userAvatar !== undefined ? { avatar: params.userAvatar } : {}),
    ...(params.participants !== undefined
      ? { participants: params.participants as ChatStreamContext['participants'] }
      : {}),
  };
}

export function useChatBoxSend(params: UseChatBoxSendParams): UseChatBoxSendResult {
  const { setChatHistory, projectId, projectIdString, isAgentsPage } = params;
  const transport = useChatStreamTransport({
    setChatHistory,
    context: buildChatStreamContext(params),
  });
  const { start } = transport;

  const startStreamedExecution = useCallback(
    async ({ conversationUuid, payload }: { readonly conversationUuid: string; readonly payload: Record<string, unknown> }) => {
      // No project ⇒ no route to POST to. Reporting false keeps the socket
      // fallback rather than silently sending nothing.
      if (projectId === undefined) return false;
      return start({
        projectId,
        conversationUuid,
        contract: isAgentsPage ? conversationApi.contracts.application : conversationApi.contracts.adhoc,
        body: buildStartBody({
          conversationUuid,
          projectId: projectIdString,
          payload,
          llmSettings: params.llmSettings,
          modelName: params.model?.name,
        }),
      });
    },
    [start, projectId, projectIdString, isAgentsPage, params.llmSettings, params.model],
  );

  const { deps } = params;
  const { mutateAsync: addParticipants } = useAddParticipantMutation();
  const createConversationForSend = useCallback(
    async (question: string) => {
      const created = await deps.createConversation({
        name: question.slice(0, 50) || t('widgets.chatBox.defaultConversationName', 'New Chat'),
        isPrivate: true,
      });
      if (!created) return undefined;

      // A plain model chat has to carry its own participants; an agent
      // conversation already has the agent as one, so this is scoped to the
      // ad-hoc path and to a chat that actually has a model to name.
      const modelName = params.model?.name;
      if (!isAgentsPage && modelName && created.id !== undefined && projectId !== undefined) {
        try {
          await addParticipants({
            projectId,
            conversationId: String(created.id),
            participants: adhocParticipants({ userId: params.userId, modelName, llmSettings: params.llmSettings }),
          });
        } catch (error) {
          // Not fatal to the send: the turn will fail its own admission with a
          // message, which is more useful than swallowing the question here.
          console.warn('[useChatBoxSend] could not add ad-hoc participants:', error);
        }
      }
      return pickIdAndUuid(created);
    },
    [deps, isAgentsPage, projectId, params.model, params.userId, params.llmSettings, addParticipants],
  );

  const uploadAttachmentsForSend = useCallback(
    async (conversationId: string | number, files: readonly File[]) => {
      const cfg = getConfig();
      if (cfg.status !== 'ok' || projectId === undefined) return { success: true, uploaded: [] };
      const outcome = await deps.uploadAttachments({
        baseUrl: cfg.config.vite_server_url,
        projectId: String(projectId),
        conversationId: String(conversationId),
        attachments: files,
      });
      return { success: outcome.success, uploaded: outcome.uploaded };
    },
    [deps, projectId],
  );

  return { startStreamedExecution, isStreaming: transport.isStreaming, createConversationForSend, uploadAttachmentsForSend };
}
