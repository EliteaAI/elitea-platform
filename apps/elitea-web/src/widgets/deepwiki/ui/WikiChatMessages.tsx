/**
 * The conversation itself: questions, answers and the thinking log between.
 *
 * Answers are MARKDOWN, rendered through `shared/ui/Markdown` — the app's own
 * `marked` + sanitise path. The legacy drawer used `react-markdown` +
 * `remark-gfm`, neither of which this app has, so this is a rewrite and not a
 * port. Questions are plain text: a question is what the user typed, and
 * interpreting it as markdown would silently eat their backticks and asterisks.
 */
import { memo } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { Markdown } from '@/shared/ui/Markdown';
import { isThinkingBlock, type ChatMessage } from '@/features/wiki-chat';

import { ThinkingStepsBlock } from './ThinkingStepsBlock';

export interface WikiChatMessagesProps {
  readonly messages: readonly ChatMessage[];
}

export const WikiChatMessages = memo(function WikiChatMessages({
  messages,
}: WikiChatMessagesProps) {
  return (
    <Stack data-testid="wiki-chat-messages" sx={{ gap: 1, flex: 1, overflowY: 'auto', p: 1.5 }}>
      {messages.map((message, index) => {
        if (isThinkingBlock(message)) {
          return <ThinkingStepsBlock key={message.id} block={message} />;
        }

        if (message.role === 'user') {
          return (
            <Paper
              // A conversation has no stable per-turn id — the provider does
              // not issue one and the legacy drawer used the array position
              // too. Turns are only ever appended, or truncated from the end by
              // a regenerate, so the position is stable for as long as the row
              // exists.
              // eslint-disable-next-line react/no-array-index-key -- see above
              key={`user-${String(index)}`}
              variant="outlined"
              sx={{ alignSelf: 'flex-end', maxWidth: '85%', p: 1, bgcolor: 'action.hover' }}
            >
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {message.content}
              </Typography>
            </Paper>
          );
        }

        if (message.isError) {
          return (
            // eslint-disable-next-line react/no-array-index-key -- see above
            <Alert key={`error-${String(index)}`} severity="error" variant="outlined">
              {message.content}
            </Alert>
          );
        }

        return (
          // eslint-disable-next-line react/no-array-index-key -- see above
          <Box key={`answer-${String(index)}`} data-testid="wiki-chat-answer" sx={{ maxWidth: '95%' }}>
            <Markdown>{message.content}</Markdown>
          </Box>
        );
      })}
    </Stack>
  );
});
