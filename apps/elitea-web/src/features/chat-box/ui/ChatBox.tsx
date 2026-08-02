import { memo, useImperativeHandle, useRef } from 'react';

import { Box } from '@mui/material';

/**
 * Phase-5 ChatBox composition root
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
export type ChatBoxProps = {
  activeConversation?: {
    id?: string;
    uuid?: string;
    name?: string;
    isNew?: boolean;
    participants?: unknown[];
    chat_history?: unknown[];
  };
  setChatHistory?: (history: unknown[] | ((prev: unknown[]) => unknown[])) => void;
  isLoadingConversation?: boolean;
  activeParticipant?: unknown;
  onSend?: (data: unknown) => Promise<unknown>;
  setIsStreaming?: (streaming: boolean) => void;
  hidden?: boolean;
  fromTheChat?: boolean;
};

export type ChatBoxHandle = {
  onClear: () => void;
  mentionUser: (content: string) => void;
  stopAll: () => void;
};

const ChatBoxInner = ({
  activeConversation,
  setChatHistory: _setChatHistory,
  hidden = false,
  fromTheChat = false,
}: ChatBoxProps) => {
  const chatInputRef = useRef<{ mentionUser?: (c: string) => void }>(null);

  useImperativeHandle(
    chatInputRef as unknown as React.Ref<ChatBoxHandle>,
    () => ({
      onClear: () => {},
      mentionUser: (content: string) => {
        chatInputRef.current?.mentionUser?.(content);
      },
      stopAll: () => {},
    }),
    [],
  );

  return (
    <Box
      sx={{
        display: hidden ? 'none' : 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
      }}
    >
      <Box sx={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
        {activeConversation?.chat_history?.map((_: unknown, i: number) => (
          <Box key={i} sx={{ padding: '0.5rem', borderBottom: '1px solid', borderColor: 'border.lines' }}>
            <Box component="span" sx={{ color: 'text.secondary' }}>
              Message {i + 1}
            </Box>
          </Box>
        ))}
        {!fromTheChat && activeConversation?.isNew && (
          <Box sx={{ padding: '1rem', textAlign: 'center', color: 'text.disabled' }}>
            Select an agent to start chatting...
          </Box>
        )}
      </Box>
      <Box sx={{ padding: '0.5rem' }}>
        <Box
          sx={{
            display: 'flex',
            gap: '0.5rem',
            padding: '0.5rem',
            border: '1px solid',
            borderColor: 'border.lines',
            borderRadius: '8px',
          }}
        >
          <Box component="span" sx={{ flex: 1, color: 'text.disabled' }}>
            Type a message...
          </Box>
          <Box component="span" sx={{ fontSize: '1rem', color: 'primary.main' }}>
            →
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

const ChatBox = memo(ChatBoxInner);
ChatBox.displayName = 'ChatBox';

export default ChatBox;
