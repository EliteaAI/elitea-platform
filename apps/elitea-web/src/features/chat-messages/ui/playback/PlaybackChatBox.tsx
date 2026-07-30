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
 *  2. `ChatMessageList` and `ChatBoxContainer`/`ChatBodyContainer` → the
 *     playback box renders a `<Box>` with the message list inline; the
 *     actual `ChatMessageList` component is a shared widget (C3 unit's
 *     scope, not C4).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { Box } from '@mui/material';

import { PlaybackToolBar } from './PlaybackToolBar';

import type { ConversationWire } from '@/entities/conversation/api/conversationApi';

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

export interface PlaybackChatBoxProps {
  /** The playback conversation (enriched with `chat_history` and `messages_count`). */
  readonly conversation: ConversationWire;
  /** MUI sx overrides for the chat message list. */
  readonly messageListSX?: Record<string, unknown>;
  /** When true, the playback box is hidden. */
  readonly hidden?: boolean;
  /** Called with error strings from the playback hooks. */
  readonly toastError?: (message: string) => void;
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
  function PlaybackChatBox({ conversation, messageListSX, hidden, toastError: _toastError }, ref) {
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

    // Sync refs
    useEffect(() => {
      messageListRef.current = messageList;
    }, [messageList]);

    useEffect(() => {
      chatHistoryRef.current = [...chatHistory];
    }, [chatHistory]);

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
      if (message !== undefined) {
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
    const onForward = useCallback(() => {
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
          // TODO: call onLoadMoreMessages() from useLoadPlaybackMessages
          setIsLoadingMore(false);
          nextMsg = chatHistoryRef.current[nextIndex];
        }

        if (nextMsg?.role === 'user') {
          setMessage(nextMsg);
          if (currentMsg?.role === 'user') {
            setMessageList([{ ...currentMsg, created_at: Date.now() }]);
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
    }, [conversation.messages_count, currentIndex, messageList]);

    if (hidden) return <></>;

    const disableBackward = !currentIndex;
    const messagesCountNum = Number(conversation.messages_count ?? 0);
    const _lastChatMsgArr: PlaybackChatMessage[] = chatHistoryRef.current;
    const _lastChatMsg: PlaybackChatMessage | undefined = _lastChatMsgArr[messagesCountNum];
    const lastUserIndex = (_lastChatMsg?.role) === 'user' ? 1 : 0;
    const disableForward =
      currentIndex >= messagesCountNum + lastUserIndex || currentIndex >= chatHistoryRef.current.length - 1;

    // Extract message attachments for the toolbar
    const rawItems = (message?.message_items ?? []) as Array<{ item_details?: { name?: string; id?: string | number } }>;
    const items = rawItems.map((item) => ({
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
          {/* TODO: ChatMessageList component (C3 unit) renders the actual messages */}
          {messageList.map((msg, i) => (
            <Box key={msg.id ?? i} sx={{ padding: '0.5rem' }}>
              {/* Placeholder for actual message rendering */}
              {msg.content && (
                <Box
                  sx={{
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    backgroundColor: msg.role === 'user' ? 'action.selected' : 'action.hover',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.isLoading ? 'Thinking...' : msg.content}
                </Box>
              )}
            </Box>
          ))}
          <div ref={messagesEndRef} />
        </Box>

        {/* Playback toolbar with backward/forward navigation */}
        <PlaybackToolBar
          onForward={onForward}
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
