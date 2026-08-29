/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * ChatMessageList.jsx` (302 lines) — renders the full message list for a
 * conversation, orchestrating individual message row rendering.
 *
 * Folds the baseline's `ChatMessageWrapper.jsx` (a per-message controller:
 * derive `isLastMessage`-gated callbacks, route to `UserMessage` vs
 * `ApplicationAnswer`) directly into this file's render loop rather than a
 * separate wrapper component — see `ChatMessageWrapper.tsx`'s deletion note
 * and this feature's `index.ts` barrel.
 *
 * Related props are grouped into option objects (`messageActions`/`tts`/
 * `continuation`/`pagination`) to stay under the §3.5 component-props
 * budget, mirroring the same grouping pattern used by sibling
 * `ApplicationAnswer.tsx`.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * ChatMessageList.jsx`.
 */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import Skeleton from '@mui/material/Skeleton';

import { ApplicationAnswer } from './ApplicationAnswer';
import { UserMessage } from './UserMessage';
import type { UserMessageUpdatedItem } from './UserMessage';

import type { HitlResumePayload } from '../chat-hitl-actions/ChatHitlActions';

import { useChatSessionStore } from '@/entities/conversation';
import { WELCOME_MESSAGE_ID } from '@/shared/lib/enums';
import { ScrollableContainer } from '@/shared/ui/ScrollableContainer';
import type { SimpleBarInstance } from '@/shared/ui/ScrollableContainer';

import type { ChatMessage } from '../../lib/convertMessagesToChatHistory';
import { t } from '@/shared/i18n';

/** How close to the top (px) a scroll position must be to fire `onScrollToTop` — baseline: `ChatMessageList.jsx`'s own `scrollTop <= 20`. */
const SCROLL_TOP_THRESHOLD = 20;

/** Per-message action callbacks, grouped to stay under the component-props budget. */
export interface ChatMessageListActions {
  /** Called when a message is copied to clipboard. */
  readonly onCopyToClipboard?: ((message: ChatMessage) => void) | undefined;
  /** Called when an AI answer is deleted. */
  readonly onDeleteAnswer?: ((messageId: string) => void) | undefined;
  /** Called when an AI answer is regenerated. */
  readonly onRegenerateAnswer?: ((messageId: string) => void) | undefined;
  /**
   * Called with `(messageId, updatedItems)` when the single eligible user
   * message (see `getOnSubmit` gating below) is edited and resubmitted.
   */
  readonly onSubmitEditedMessage?:
    | ((messageId: string, updatedItems: readonly UserMessageUpdatedItem[]) => void)
    | undefined;
}

/** Read-aloud (TTS) props, grouped to stay under the component-props budget. */
export interface ChatMessageListTts {
  /** Whether auto-speak mode is active. */
  readonly autoSpeak?: boolean;
  /** Called for auto-speak (TTS) — threaded straight to each `ApplicationAnswer`. */
  readonly onAutoSpeak?: ((text: string, messageId: string) => void) | undefined;
  /** Currently speaking message ID. */
  readonly speakingMessageId?: string | undefined;
  /** TTS speaking segments. */
  readonly speakingSegments?: readonly unknown[] | undefined;
  /** TTS spoken range. */
  readonly spokenRange?: { readonly start: number; readonly end: number } | undefined;
}

/** MCP-auth / token-limit continue-execution and HITL props, grouped to stay under the component-props budget. */
export interface ChatMessageListContinuation {
  /** Called when the user continues a paused MCP-auth-required execution — only offered on the last message. */
  readonly onContinueMcpExecution?: ((messageId: string, addToIgnoreList?: boolean) => void) | undefined;
  /** Called when the user continues a token-limit-paused execution — only offered on the last message. */
  readonly onContinueTokenLimitExecution?: ((messageId: string) => void) | undefined;
  /** Called when a HITL interrupt is resumed — only offered on the last message. */
  readonly onHitlResume?: ((payload: HitlResumePayload) => void) | undefined;
  /** Hides the token-limit continue prompt even when a message is paused for it. */
  readonly hideContinueButton?: boolean;
  /** Hides HITL approval cards even when a message carries a pending interrupt. */
  readonly hideHitlActions?: boolean;
}

/** Older-messages pagination props, grouped to stay under the component-props budget. */
export interface ChatMessageListPagination {
  /** Whether older messages are being fetched (renders a loading skeleton above the list). */
  readonly isLoadingMore?: boolean;
  /** Called when the list is scrolled near the top — a future pagination consumer's trigger. */
  readonly onScrollToTop?: (() => void) | undefined;
}

/** @public Props for `ChatMessageList`. */
export interface ChatMessageListProps {
  /** The list of messages to render. */
  readonly chatHistory: readonly ChatMessage[];
  /** Whether a message is currently streaming. */
  readonly isStreaming?: boolean;
  /** The user ID for identifying the current user. */
  readonly userId?: string;
  /**
   * The project the conversation lives in — threaded to each `UserMessage`'s
   * attachment cards, whose artifact-storage download path refuses without it
   * (`NormalAttachment`'s own doc: "Required to download an
   * artifact-storage-backed attachment").
   */
  readonly projectId?: string | undefined;
  readonly messageActions?: ChatMessageListActions;
  readonly tts?: ChatMessageListTts;
  readonly continuation?: ChatMessageListContinuation;
  readonly pagination?: ChatMessageListPagination;
  /**
   * What to render instead of the transcript when `chatHistory` is empty.
   * The caller owns this because the empty branch is not just different
   * copy — `ChatBox` centres the greeting and the composer together as one
   * block (see `ChatBox.layout.ts`), and only the caller knows the user's
   * name to greet. Omitted, the plain fallback line below is used.
   */
  readonly emptyState?: ReactNode;
}

/** Baseline `ChatMessageWrapper.jsx`'s `canDeleteThisAIMessage` — whether `userId` authored the question this AI answer replies to. */
function canDeleteAiMessage(chatHistory: readonly ChatMessage[], message: ChatMessage, userId: string): boolean {
  const question = chatHistory.find((item) => item.id === message.questionId);
  return question?.userId === userId;
}

/**
 * `ChatMessageList` — renders the full message list for a conversation.
 * Each message is rendered according to its role (user / assistant), with
 * per-message callback gating (delete/regenerate/continue/HITL) folded in
 * from the baseline's `ChatMessageWrapper`.
 */
// eslint-disable-next-line eslint/complexity, eslint/max-lines-per-function -- per-message gating folded in from ChatMessageWrapper; oxlint's complexity+max-lines are already disabled repo-wide for this directory (.oxlintrc.json)
export function ChatMessageList({
  chatHistory,
  isStreaming = false,
  userId,
  projectId,
  messageActions: { onCopyToClipboard, onDeleteAnswer, onRegenerateAnswer, onSubmitEditedMessage } = {},
  tts: { onAutoSpeak, speakingMessageId, speakingSegments, spokenRange } = {},
  continuation: {
    onContinueMcpExecution,
    onContinueTokenLimitExecution,
    onHitlResume,
    hideContinueButton = false,
    hideHitlActions = false,
  } = {},
  pagination: { isLoadingMore = false, onScrollToTop } = {},
  emptyState,
}: ChatMessageListProps): ReactNode {
  const scrollRef = useRef<SimpleBarInstance | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageRowRefs = useRef<Record<string, HTMLElement | null>>({});

  const messageIdToView = useChatSessionStore((state) => state.messageIdToView);
  const setMessageIdToView = useChatSessionStore((state) => state.setMessageIdToView);

  const setMessageRowRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      messageRowRefs.current[id] = el;
    },
    [],
  );

  // Baseline `getOnSubmit` gating (ChatMessageList.jsx): edit-and-resubmit is
  // only offered for the single last user-role message, owned by the current
  // user, while nothing is streaming. `isLoading` isn't in this component's
  // props yet (ChatBox.tsx doesn't supply it) so it's omitted here rather
  // than invented.
  const lastUserMessageIndex = useMemo(
    () => chatHistory.reduce((last, msg, i) => (msg.role === 'user' ? i : last), -1),
    [chatHistory],
  );

  const firstMessageId = chatHistory[0]?.id;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
    // A new conversation (first message identity changes) or a newly-arrived
    // message (list length changes) both warrant scrolling to the bottom —
    // baseline: `ChatMessageList.jsx`'s own `[activeConversation?.id]` effect.
  }, [firstMessageId, chatHistory.length]);

  useEffect(() => {
    const scrollEl = scrollRef.current?.getScrollElement();
    if (!scrollEl || !onScrollToTop) return undefined;
    const handleScroll = (): void => {
      if (scrollEl.scrollTop <= SCROLL_TOP_THRESHOLD) onScrollToTop();
    };
    scrollEl.addEventListener('scroll', handleScroll);
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, [onScrollToTop]);

  useEffect(() => {
    if (!messageIdToView || !chatHistory.length) return;
    const target = messageRowRefs.current[messageIdToView];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setMessageIdToView('');
    }
  }, [messageIdToView, chatHistory, setMessageIdToView]);

  if (!chatHistory?.length) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 4,
          color: 'text.secondary',
        }}
      >
        {emptyState ?? t('features.chatMessages.noMessages', 'No messages yet')}
      </Box>
    );
  }

  return (
    <ScrollableContainer ref={scrollRef}>
      <List
        data-testid="chat-message-list"
        disablePadding
        sx={{ px: 2 }}
      >
        {isLoadingMore && (
          <Box component="li" sx={{ display: 'flex', flexDirection: 'column', gap: 1, pb: 1, listStyle: 'none' }}>
            {Array.from({ length: 3 }).map((_, index) => (
              // eslint-disable-next-line react/no-array-index-key -- fixed-length placeholder rows, no stable identity
              <Skeleton key={index} animation="wave" variant="rounded" sx={{ width: '100%', height: '3rem' }} />
            ))}
          </Box>
        )}
        {chatHistory.map((message, index) => {
          const isUser = message.role === 'user';
          const messageId = message.id;
          const isLastMessage = index === chatHistory.length - 1;
          const messageIsStreaming = Boolean(message.isStreaming) || (isLastMessage && isStreaming);
          const isEligibleForEdit =
            isUser &&
            index === lastUserMessageIndex &&
            !isStreaming &&
            (userId === undefined || userId === message.userId);
          const canDeleteMessage = isUser
            ? userId === undefined || message.userId === userId
            : userId === undefined || canDeleteAiMessage(chatHistory, message, userId);
          const handleDelete =
            isLastMessage && message.id !== WELCOME_MESSAGE_ID && !message.isSummarized && canDeleteMessage && onDeleteAnswer
              ? () => { onDeleteAnswer(messageId); }
              : undefined;
          const handleCopy = onCopyToClipboard ? () => { onCopyToClipboard(message); } : undefined;

          return (
            <Box
              component="li"
              key={messageId}
              data-testid="chat-message-item"
              ref={setMessageRowRef(messageId)}
              sx={{ mb: 1, listStyle: 'none' }}
            >
              {isUser ? (
                <UserMessage
                  message={message}
                  messageId={messageId}
                  projectId={projectId}
                  onCopy={handleCopy}
                  onDelete={handleDelete}
                  onSubmit={isEligibleForEdit ? onSubmitEditedMessage : undefined}
                />
              ) : (
                <ApplicationAnswer
                  answer={message}
                  messageId={messageId}
                  isLastMessage={isLastMessage}
                  toolActions={message.toolActions}
                  status={{ isLoading: Boolean(message.isLoading), isStreaming: messageIsStreaming }}
                  actions={{
                    onCopy: handleCopy,
                    onDelete: handleDelete,
                    onRegenerate:
                      isLastMessage && !message.isLoading && !messageIsStreaming && onRegenerateAnswer
                        ? () => { onRegenerateAnswer(messageId); }
                        : undefined,
                    shouldDisableRegenerate: messageIsStreaming || Boolean(message.isLoading) || message.id === WELCOME_MESSAGE_ID,
                  }}
                  continuation={{
                    hideContinueButton,
                    onContinueMcpExecution: isLastMessage ? onContinueMcpExecution : undefined,
                    onContinueTokenLimitExecution: isLastMessage ? onContinueTokenLimitExecution : undefined,
                  }}
                  hitl={{
                    hitlInterrupt: hideHitlActions ? undefined : message.hitlInterrupt,
                    hitlInterrupts: hideHitlActions ? undefined : message.hitlInterrupts,
                    onHitlResume: !hideHitlActions && isLastMessage ? onHitlResume : undefined,
                  }}
                  tts={{
                    onAutoSpeak,
                    ...(speakingMessageId && { speakingMessageId }),
                    ...(speakingSegments && { speakingSegments }),
                    ...(spokenRange && { spokenRange }),
                  }}
                />
              )}
            </Box>
          );
        })}
        <Box component="li" ref={messagesEndRef} sx={{ listStyle: 'none' }} />
      </List>
    </ScrollableContainer>
  );
}
