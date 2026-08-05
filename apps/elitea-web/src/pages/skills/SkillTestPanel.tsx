import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { NewChatInput } from '@/features/chat-input';
import {
  cancelSkillTest,
  testSkill,
  type SkillTestTurn,
} from '@/features/skills';
import { useSocketClient } from '@/shared/api/socket/client';
import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { Markdown } from '@/shared/ui/Markdown';

interface TestMessage extends SkillTestTurn {
  readonly id: string;
  readonly isLoading?: boolean;
}

export interface SkillTestPanelProps {
  readonly projectId: string;
  readonly instructions: string;
  readonly skillName: string;
}

export function skillTestMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  return JSON.stringify(content);
}

export function skillTestEventType(payload: Record<string, unknown>): string {
  return typeof payload['type'] === 'string' ? payload['type'] : '';
}

export function isSkillTestChunkEvent(type: string): boolean {
  return type === 'chunk' || type === 'AIMessageChunk' || type === 'agent_llm_chunk';
}

type SkillTestEventKind = 'error' | 'response' | 'chunk' | 'end' | 'ignore';

export function skillTestEventKind(type: string): SkillTestEventKind {
  if (type === 'error' || type === 'llm_error') return 'error';
  if (type === 'agent_response') return 'response';
  if (isSkillTestChunkEvent(type)) return 'chunk';
  if (type === 'agent_llm_end') return 'end';
  return 'ignore';
}

export function skillTestStreamId(payload: Record<string, unknown>): string | undefined {
  const streamId = payload['stream_id'];
  return typeof streamId === 'string' ? streamId : undefined;
}

interface StreamCorrelation {
  readonly active: string | undefined;
  readonly accept: boolean;
}

export function correlateSkillTestStream(
  active: string | undefined,
  incoming: string | undefined,
): StreamCorrelation {
  if (!active && incoming) return { active: incoming, accept: true };
  if (incoming && incoming !== active) return { active, accept: false };
  return { active, accept: true };
}

export function replaceSkillTestAssistant(
  messages: readonly TestMessage[],
  assistantId: string,
  content: string,
  append: boolean,
): readonly TestMessage[] {
  return messages.map((message) => {
    if (message.id !== assistantId) return message;
    return {
      ...message,
      content: append ? message.content + content : content,
      isLoading: false,
    };
  });
}

export function hasSkillTestFinishReason(payload: Record<string, unknown>): boolean {
  const metadata = payload['response_metadata'] as { readonly finish_reason?: unknown } | undefined;
  return Boolean(metadata?.finish_reason);
}

const EMPTY_AGENT_EDITOR = {
  activeParticipant: undefined,
  activeParticipantDetails: undefined,
  isAgentsPage: true,
  onSelectVersion: () => undefined,
  variables: [],
  onChangeVariables: () => undefined,
};

export function SkillTestPanel({
  projectId,
  instructions,
  skillName,
}: SkillTestPanelProps): ReactNode {
  const socketClient = useSocketClient();
  const [messages, setMessages] = useState<readonly TestMessage[]>([]);
  const [modelName, setModelName] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const activeAssistantId = useRef<string | undefined>(undefined);
  const activeStreamId = useRef<string | undefined>(undefined);
  const activeTaskId = useRef<string | undefined>(undefined);

  const finish = useCallback(() => {
    const assistantId = activeAssistantId.current;
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId ? { ...message, isLoading: false } : message,
      ),
    );
    setIsStreaming(false);
    activeAssistantId.current = undefined;
    activeStreamId.current = undefined;
    activeTaskId.current = undefined;
  }, []);

  const handleSocketMessage = useCallback(
    (payload: Record<string, unknown>): void => {
      const correlation = correlateSkillTestStream(activeStreamId.current, skillTestStreamId(payload));
      activeStreamId.current = correlation.active;
      if (!correlation.accept) return;

      const type = skillTestEventType(payload);
      const assistantId = activeAssistantId.current;
      if (!assistantId) return;
      switch (skillTestEventKind(type)) {
        case 'error': {
          const eventError = skillTestMessageText(payload['content']);
          setError(eventError === '' ? t('skills.test.error', 'Failed to generate a response.') : eventError);
          finish();
          return;
        }
        case 'response':
          setMessages((current) =>
            replaceSkillTestAssistant(current, assistantId, skillTestMessageText(payload['content']), false),
          );
          finish();
          return;
        case 'chunk': {
          setMessages((current) =>
            replaceSkillTestAssistant(current, assistantId, skillTestMessageText(payload['content']), true),
          );
          if (hasSkillTestFinishReason(payload)) finish();
          return;
        }
        case 'end':
          finish();
          return;
        case 'ignore':
          return;
      }
    },
    [finish],
  );

  useEffect(() => {
    socketClient.on('application_predict', handleSocketMessage);
    return () => socketClient.off('application_predict', handleSocketMessage);
  }, [handleSocketMessage, socketClient]);

  const run = useCallback(
    async (question: string, history: readonly TestMessage[]) => {
      const trimmed = question.trim();
      if (!trimmed || isStreaming) return;
      if (!modelName.trim()) {
        setError(t('skills.test.modelRequired', 'Enter a model name before testing.'));
        return;
      }
      const userMessage: TestMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed };
      const assistantMessage: TestMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        isLoading: true,
      };
      const nextMessages = [...history, userMessage, assistantMessage];
      setMessages(nextMessages);
      setError(undefined);
      setIsStreaming(true);
      activeAssistantId.current = assistantMessage.id;

      const streamId = crypto.randomUUID();
      try {
        const result = await testSkill(projectId, {
          sid: socketClient.socket.id ?? '',
          messageId: crypto.randomUUID(),
          streamId,
          instructions,
          userInput: trimmed,
          chatHistory: history.map(({ role, content }) => ({ role, content })),
          modelName: modelName.trim(),
          temperature: 0.2,
          maxTokens: 2_000,
        });
        if (result.task_id) activeTaskId.current = result.task_id;
      } catch {
        setError(t('skills.test.error', 'Failed to generate a response.'));
        finish();
      }
    },
    [finish, instructions, isStreaming, modelName, projectId, socketClient.socket.id],
  );

  const stop = (): void => {
    if (activeTaskId.current) void cancelSkillTest(projectId, activeTaskId.current);
    finish();
  };

  return (
    <Box
      sx={containerSx}
      data-testid="skill-test-panel"
    >
      <Box sx={headerSx}>
        <Typography variant="headingSmall">
          {t('skills.test.title', 'Test')} {skillName || t('skills.test.fallbackName', 'skill')}
        </Typography>
        <BaseBtn
          variant="secondary"
          disabled={messages.length === 0 || isStreaming}
          onClick={() => setMessages([])}
        >
          {t('skills.test.clear', 'Clear')}
        </BaseBtn>
      </Box>
      <TextField
        size="small"
        label={t('skills.test.model', 'Model name')}
        value={modelName}
        onChange={(event) => setModelName(event.target.value)}
      />
      <Paper sx={conversationSx}>
        {messages.length === 0 ? (
          <Typography>{t('skills.test.empty', 'Send a message to try these instructions.')}</Typography>
        ) : (
          <List>
            {messages.map((message, index) => (
              <ListItem
                key={message.id}
                sx={message.role === 'user' ? userMessageSx : assistantMessageSx}
              >
                <Box sx={{ width: '100%' }}>
                  <Typography variant="labelSmall">
                    {message.role === 'user' ? t('skills.test.you', 'You') : skillName}
                  </Typography>
                  {message.isLoading ? (
                    <Typography>{t('skills.test.thinking', 'Thinking…')}</Typography>
                  ) : (
                    <Markdown>{message.content}</Markdown>
                  )}
                  <Box sx={messageActionsSx}>
                    <Tooltip title={t('skills.test.copy', 'Copy')}>
                      <IconButton
                        size="small"
                        aria-label={t('skills.test.copy', 'Copy')}
                        onClick={() => void navigator.clipboard.writeText(message.content)}
                      >
                        <ContentCopyOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {message.role === 'assistant' && (
                      <Tooltip title={t('skills.test.regenerate', 'Regenerate')}>
                        <IconButton
                          size="small"
                          aria-label={t('skills.test.regenerate', 'Regenerate')}
                          disabled={isStreaming}
                          onClick={() => {
                            const question = messages[index - 1];
                            if (question?.role === 'user') void run(question.content, messages.slice(0, index - 1));
                          }}
                        >
                          <RefreshOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={t('skills.test.delete', 'Delete')}>
                      <IconButton
                        size="small"
                        aria-label={t('skills.test.delete', 'Delete')}
                        onClick={() => setMessages((current) => current.filter((item) => item.id !== message.id))}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
      {error && <Typography role="alert">{error}</Typography>}
      <NewChatInput
        state={{ isStreaming, disabledSend: isStreaming }}
        content={{ placeholder: t('skills.test.placeholder', 'Type your message…') }}
        callbacks={{
          onSend: (question) => {
            void run(question, messages);
          },
          onStopGeneration: stop,
        }}
        agentEditor={EMPTY_AGENT_EDITOR}
        slots={{
          modelSelector: null,
          sendControl: ({ disabledSend, onSend }) => (
            <BaseBtn
              variant="contained"
              disabled={disabledSend}
              onClick={onSend}
            >
              {t('skills.test.send', 'Send')}
            </BaseBtn>
          ),
        }}
      />
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1.5),
  minWidth: 0,
  height: '100%',
});
const headerSx: SxProps<Theme> = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const conversationSx: SxProps<Theme> = (theme: Theme) => ({
  flex: 1,
  minHeight: '18rem',
  overflowY: 'auto',
  padding: theme.spacing(1.5),
});
const userMessageSx: SxProps<Theme> = (theme: Theme) => ({
  marginBottom: theme.spacing(1),
  backgroundColor: theme.vars.palette.background.userInputBackground,
  borderRadius: theme.vars.shape.radiusMd,
});
const assistantMessageSx: SxProps<Theme> = (theme: Theme) => ({
  marginBottom: theme.spacing(1),
  backgroundColor: theme.vars.palette.background.secondary,
  borderRadius: theme.vars.shape.radiusMd,
});
const messageActionsSx: SxProps<Theme> = { display: 'flex', justifyContent: 'flex-end' };
