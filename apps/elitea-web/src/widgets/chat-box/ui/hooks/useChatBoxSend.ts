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

/** @public Params for `useChatBoxSend`. */
export interface UseChatBoxSendParams {
  readonly deps: SendDeps;
  readonly setChatHistory: (updater: (prev: readonly ChatMessage[]) => readonly ChatMessage[]) => void;
  readonly projectId: string | number | undefined;
  readonly projectIdString: string | undefined;
  /** An agent-app conversation takes a different execution contract from an ad-hoc/test one. */
  readonly isAgentsPage?: boolean | undefined;
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
        body: { ...payload, conversation_uuid: conversationUuid, project_id: projectIdString },
      });
    },
    [start, projectId, projectIdString, isAgentsPage],
  );

  const { deps } = params;
  const createConversationForSend = useCallback(
    async (question: string) => {
      const created = await deps.createConversation({
        name: question.slice(0, 50) || t('widgets.chatBox.defaultConversationName', 'New Chat'),
        isPrivate: true,
      });
      return created ? pickIdAndUuid(created) : undefined;
    },
    [deps],
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
