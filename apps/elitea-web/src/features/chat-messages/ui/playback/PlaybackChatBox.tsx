/**
 * ui/playback/PlaybackChatBox.tsx — playback mode chat box that replays
 * messages sequentially, ported from
 * `apps/elitea-ui/src/pages/NewChat/PlaybackChatBox.jsx` (C4 batch).
 *
 * Renders a chat message list in playback mode: the user clicks forward/backward
 * to step through messages one at a time. Messages are loaded lazily via the
 * `useLoadPlaybackMessages` hook when the user reaches the end.
 *
 * **DEVIATIONS:**
 *  1. Redux `useSelector` for the user → the `activeConversation` is passed
 *     as a prop (the playback hook already enriches it with user context).
 *  2. `ChatBoxContainer`/`ChatBodyContainer` are not ported — the playback
 *     box renders a plain scrolling `<Box>` around the list. The list
 *     itself is the real `ChatMessageList` (see below); only the two
 *     container chrome components remain unported.
 *
 * ── The message list ─────────────────────────────────────────────────────
 * This file used to render inline placeholder boxes ("Placeholder for
 * actual message rendering") on the grounds that `ChatMessageList` was
 * another unit's scope. That blocker is stale — `ui/chat-box/
 * ChatMessageList.tsx` exists next door in this same feature — so the real
 * list is rendered instead. Playback passes NO action callbacks: copy,
 * delete, regenerate, edit and TTS are all live-conversation gestures, and
 * a replay of a historical transcript has nothing to mutate. `isStreaming`
 * is likewise never set: the "thinking" beat playback fakes is per-message
 * (`isLoading` on the row being revealed), not a live stream.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { Box } from '@mui/material';

import { PlaybackToolBar } from './PlaybackToolBar';

import type { ConversationWire } from '@/entities/conversation/api/conversationApi';

import { t } from '@/shared/i18n';

import { ChatMessageList } from '../chat-box/ChatMessageList';
import type { ChatMessage } from '../../lib/convertMessagesToChatHistory';
import { useLoadPlaybackMessages } from '../../model/useLoadPlaybackMessages';

/** The playback mode message shape — each entry is either a chat message or a boundary marker (`isStart`/`isEnd`). */
export interface PlaybackChatMessage {
  readonly id?: string | number;
  readonly role?: string;
  readonly name?: string;
  readonly content?: string;
  readonly message_items?: readonly unknown[];
  readonly isLoading?: boolean;
  readonly isStart?: boolean;
  readonly isEnd?: boolean;
  readonly created_at?: number;
}

/**
 * A playback entry rendered as a `ChatMessageList` row.
 *
 * The two shapes that reach `messageList` DISAGREE on spelling, and both are
 * real: `conversation.chat_history` arrives straight off the wire
 * (`content`/`message_items`/`created_at`), while `useLoadPlaybackMessages`
 * returns rows already through `convertMessagesToChatHistory`
 * (`content`/`messageItems`/`createdAt`) — and this component splices the
 * second kind into the first kind's array. Reading only one spelling is why
 * this must be an adapter and not a cast: a lazily-loaded page's attachments
 * would silently vanish, or a wire row's would.
 *
 * The boundary sentinels (`{isStart}`/`{isEnd}`) never reach here — `onForward`
 * only ever pushes real messages into `messageList` — but a row with no `role`
 * still degrades to `assistant`, which is what `ChatMessageList` treats as
 * "not the reader's own message" and therefore the read-only branch.
 */
export function toChatMessage(entry: PlaybackChatMessage, index: number): ChatMessage {
  const loose = entry as PlaybackChatMessage & {
    readonly messageItems?: readonly unknown[];
    readonly createdAt?: string;
    readonly avatar?: string;
    readonly userId?: string;
  };
  const createdAt = loose.createdAt ?? (entry.created_at !== undefined ? new Date(entry.created_at).toISOString() : '');
  return {
    id: String(entry.id ?? `playback-${String(index)}`),
    role: entry.role ?? 'assistant',
    name: entry.name ?? '',
    content: entry.content ?? '',
    createdAt,
    ...(loose.avatar !== undefined ? { avatar: loose.avatar } : {}),
    ...(loose.userId !== undefined ? { userId: loose.userId } : {}),
    messageItems: (loose.messageItems ?? entry.message_items ?? []) as ChatMessage['messageItems'],
    ...(entry.isLoading !== undefined ? { isLoading: entry.isLoading } : {}),
  };
}

export interface PlaybackChatBoxProps {
  /** The playback conversation (enriched with `chat_history` and `messages_count`). */
  readonly conversation: ConversationWire;
  /** MUI sx overrides for the chat message list. */
  readonly messageListSX?: Record<string, unknown>;
  /** When true, the playback box is hidden. */
  readonly hidden?: boolean;
  /** Called with error strings from the playback hooks. */
  readonly toastError?: (message: string) => void;
  /** The project ID — needed to fetch additional playback pages via `useLoadPlaybackMessages`. */
  readonly projectId?: string | number;
}

/** Imperative handle for resetting playback state. */
export interface PlaybackChatBoxHandle {
  /** Resets playback to the initial state. */
  reset: () => void;
}

/**
 * Renders the playback chat box — a sequential replay of conversation messages.
 *
 * Matches the baseline `PlaybackChatBox.jsx` behaviour:
 * - Maintains a `chatHistory` (prefixed with `{isStart: true}`, suffixed with `{isEnd: true}`)
 * - Maintains a `messageList` (the messages shown in the current playback window)
 * - Steps forward/backward through `chatHistory` via `currentIndex`
 * - Loads more messages lazily when approaching the end
 * - Renders `ChatMessageList` for the current window and a `PlaybackToolBar` for navigation
 */
export const PlaybackChatBox = forwardRef<PlaybackChatBoxHandle, PlaybackChatBoxProps>(
  function PlaybackChatBox({ conversation, messageListSX, hidden, toastError: _toastError, projectId }, ref) {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const [chatHistory, setChatHistory] = useState<PlaybackChatMessage[]>(() => {
      const items = (conversation.chat_history ?? []) as unknown as PlaybackChatMessage[];
      return [{ isStart: true }, ...items, { isEnd: true }];
    });

    const [messageList, setMessageList] = useState<PlaybackChatMessage[]>([]);
    const messageListRef = useRef<PlaybackChatMessage[]>(messageList);
    const chatHistoryRef = useRef<PlaybackChatMessage[]>([...chatHistory]);

    const [currentIndex, setCurrentIndex] = useState(0);
    const [message, setMessage] = useState<PlaybackChatMessage | null | undefined>(undefined);
    const [isMockingThinking, setIsMockingThinking] = useState(false);
    const [_page, setPage] = useState(1);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const { messages: loadedPlaybackMessages, loadMore: loadMorePlaybackMessages } = useLoadPlaybackMessages({
      projectId: projectId ?? '',
      conversationId: String(conversation.id),
      ...(conversation.participants ? { participants: conversation.participants } : {}),
    });
    const loadedMessageCountRef = useRef(0);

    // Sync refs
    useEffect(() => {
      messageListRef.current = messageList;
    }, [messageList]);

    useEffect(() => {
      chatHistoryRef.current = [...chatHistory];
    }, [chatHistory]);

    // Splice newly-loaded playback messages (deduped by id) into chatHistory,
    // right before the trailing `{isEnd: true}` sentinel — mirrors the old
    // app's "await onLoadMoreMessages(), dedup by id, splice into ref,
    // setChatHistory" pattern (PlaybackChatBox.jsx:140-148), adapted for
    // useLoadPlaybackMessages's state-based (not return-value-based) contract.
    useEffect(() => {
      if (loadedPlaybackMessages.length === loadedMessageCountRef.current) return;
      loadedMessageCountRef.current = loadedPlaybackMessages.length;

      const newMessages = loadedPlaybackMessages.filter(
        (msg) => !chatHistoryRef.current.some((item) => item.id === msg.id),
      );
      if (newMessages.length === 0) return;

      const insertIndex = Math.max(chatHistoryRef.current.length - 1, 0);
      const spliced = [...chatHistoryRef.current];
      spliced.splice(insertIndex, 0, ...(newMessages as unknown as PlaybackChatMessage[]));
      chatHistoryRef.current = spliced;
      setChatHistory(spliced);
    }, [loadedPlaybackMessages]);

    // Reset chat history when conversation changes
    useEffect(() => {
      const items = (conversation.chat_history ?? []) as unknown as PlaybackChatMessage[];
      setChatHistory([{ isStart: true }, ...items, { isEnd: true }]);
    }, [conversation.chat_history]);

    // Auto-scroll to bottom of message list
    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    }, [messageList]);

    /** Reset playback to initial state. */
    const reset = useCallback(() => {
      setChatHistory([]);
      setMessageList([]);
      setCurrentIndex(0);
      setMessage(undefined);
      setIsMockingThinking(false);
      setPage(1);
    }, []);

    useImperativeHandle(ref, () => ({ reset }));

    /** Step backward through the chat history. */
    const onBackward = useCallback(() => {
      const prevIndex = currentIndex - 1;
      if (message) {
        setMessage(null);
        setCurrentIndex((prev) => prev - 1);
      } else if (chatHistoryRef.current[currentIndex]?.isEnd) {
        if (chatHistoryRef.current[prevIndex]?.role === 'user') {
          setMessage(chatHistoryRef.current[prevIndex]);
          setMessageList((prev) => {
            const newMessages = [...prev];
            newMessages.pop();
            return newMessages;
          });
          setCurrentIndex((prev) => prev - 1);
        } else {
          setMessage(null);
          setMessageList((prev) => {
            const newMessages = [...prev];
            newMessages.pop();
            return newMessages;
          });
          setCurrentIndex((prev) => prev - 1);
        }
      } else if (chatHistoryRef.current[currentIndex]?.isStart) {
        setMessage(null);
        setMessageList([]);
        setCurrentIndex(0);
      } else if (chatHistoryRef.current[currentIndex]?.role === 'user') {
        setMessage(chatHistoryRef.current[currentIndex]);
        setMessageList((prev) => {
          const newMessages = [...prev];
          newMessages.pop();
          return newMessages;
        });
      } else if (chatHistoryRef.current[currentIndex]?.role === 'assistant') {
        if (chatHistoryRef.current[prevIndex]?.role === 'user') {
          setMessage(chatHistoryRef.current[prevIndex]);
          setMessageList((prev) => {
            const newMessages = [...prev];
            newMessages.pop();
            newMessages.pop();
            return newMessages;
          });
        } else {
          setMessage(null);
          setMessageList((prev) => {
            const newMessages = [...prev];
            newMessages.pop();
            return newMessages;
          });
        }
        setCurrentIndex((prev) => prev - 1);
      }
    }, [currentIndex, message]);

    /** Step forward through the chat history, loading more messages when needed. */
    const onForward = useCallback(async () => {
      const nextIndex = currentIndex + 1;
      const currentMsg = chatHistoryRef.current[currentIndex];
      let nextMsg = chatHistoryRef.current[nextIndex];

      if (currentMsg?.isStart) {
        setMessageList([]);
        setMessage(chatHistoryRef.current[nextIndex]);
      } else {
        const messagesCount = Number(conversation.messages_count ?? 0);
        if (chatHistoryRef.current.length < messagesCount + 2 && chatHistoryRef.current[nextIndex]?.isEnd) {
          // Load more messages
          setIsLoadingMore(true);
          await loadMorePlaybackMessages();
          setIsLoadingMore(false);
          nextMsg = chatHistoryRef.current[nextIndex];
        }

        if (nextMsg?.role === 'user') {
          setMessage(nextMsg);
          if (currentMsg?.role === 'user') {
            setMessageList((prev) => [...prev, { ...currentMsg, created_at: Date.now() }]);
          }
        } else if (nextMsg?.role === 'assistant') {
          setMessage(null);
          const newMessages =
            currentMsg?.role === 'user'
              ? [
                  ...messageList,
                  { ...currentMsg, created_at: Date.now() },
                  { ...nextMsg, isLoading: true, content: '', created_at: Date.now() },
                ]
              : [
                  ...messageList,
                  { ...nextMsg, isLoading: true, content: '', created_at: Date.now() },
                ];

          const lastMessageIndex = newMessages.length - 1;
          setIsMockingThinking(true);
          setTimeout(() => {
            setMessageList((prev) => {
              const modifiedMessages = [...prev];
              if (modifiedMessages[lastMessageIndex]) {
                modifiedMessages[lastMessageIndex] = {
                  ...modifiedMessages[lastMessageIndex],
                  isLoading: false,
                  content: (chatHistoryRef.current[nextIndex] as PlaybackChatMessage)?.content ?? '',
                  created_at: Date.now(),
                };
              }
              return modifiedMessages;
            });
            setIsMockingThinking(false);
          }, 1000);
          setMessageList(newMessages);
        } else {
          setMessage(null);
          setMessageList((prev) => [...prev, { ...currentMsg, created_at: Date.now() }]);
        }
      }

      setCurrentIndex((prev) => prev + 1);
    }, [conversation.messages_count, currentIndex, messageList, loadMorePlaybackMessages]);

    if (hidden) return <></>;

    const disableBackward = !currentIndex;
    const messagesCountNum = Number(conversation.messages_count ?? 0);
    const _lastChatMsgArr: PlaybackChatMessage[] = chatHistoryRef.current;
    const _lastChatMsg: PlaybackChatMessage | undefined = _lastChatMsgArr[messagesCountNum];
    const lastUserIndex = (_lastChatMsg?.role) === 'user' ? 1 : 0;
    const disableForward =
      currentIndex >= messagesCountNum + lastUserIndex || currentIndex >= chatHistoryRef.current.length - 1;

    // Extract message attachments for the toolbar
    const rawItems = (message?.message_items ?? []) as Array<{ item_type?: string; item_details?: { name?: string; id?: string | number } }>;
    const items = rawItems
      .filter((item) => item.item_type === 'attachment_message')
      .map((item) => ({
        name: item.item_details?.name ?? '',
        id: item.item_details?.id ?? '',
      }));
    const attachments: import('./PlaybackToolBar').PlaybackToolBarAttachment[] = items.filter((a) => a.name.length > 0 && a.id != null) as import('./PlaybackToolBar').PlaybackToolBarAttachment[];

    return (
      <Box
        role="presentation"
        sx={{
          paddingBottom: '0px',
          ...messageListSX,
        }}
      >
        {/* Chat message list area */}
        <Box
          sx={{
            height: '500px',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <ChatMessageList
            chatHistory={messageList.map(toChatMessage)}
            {...(projectId !== undefined ? { projectId: String(projectId) } : {})}
            // Playback starts on the `{isStart}` sentinel with an empty
            // window, so the list's own "No messages yet" default would
            // claim the conversation is empty when it merely has not been
            // stepped into yet.
            emptyState={
              <span data-testid="playback-empty-state">
                {t('features.chatMessages.playback.notStarted', 'Press forward to replay this conversation.')}
              </span>
            }
          />
          <div ref={messagesEndRef} />
        </Box>

        {/* Playback toolbar with backward/forward navigation */}
        <PlaybackToolBar
          onForward={() => {
            void onForward();
          }}
          onBackward={onBackward}
          disableBackward={disableBackward}
          disableForward={disableForward}
          sx={{ gap: '8px', alignItems: 'center', marginTop: '0.5rem' }}
          isMockingThinking={isMockingThinking || isLoadingMore}
          attachments={attachments}
          {...(message != null ? { message: message as unknown as Record<string, unknown> } : {})}
        />
      </Box>
    );
  },
);

PlaybackChatBox.displayName = 'PlaybackChatBox';
