/**
 * The plan a deep-research run is working through.
 *
 * Rendered ONLY when there is one. An empty panel would say a plan exists and
 * is empty, which is a different claim from "this run does not have a plan" —
 * and `ask` runs never produce one.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import type { ChatTodo } from '@/features/wiki-chat';

export interface ResearchTodosPanelProps {
  readonly todos: readonly ChatTodo[] | null;
}

export const ResearchTodosPanel = memo(function ResearchTodosPanel({
  todos,
}: ResearchTodosPanelProps) {
  if (!todos || todos.length === 0) return null;

  return (
    <Box data-testid="wiki-chat-todos" sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="overline" color="text.secondary">
        {t('widgets.deepwiki.chat.researchPlan', 'Research plan')}
      </Typography>
      <Stack sx={{ gap: 0.5, mt: 0.5 }}>
        {todos.map((todo, index) => (
          <Stack
            // The provider does not promise an id on every entry, and the plan
            // is replaced wholesale rather than reordered, so the index is a
            // stable key here.
            // eslint-disable-next-line react/no-array-index-key -- see above
            key={todo.id ?? index}
            sx={{ flexDirection: 'row', gap: 1, alignItems: 'center' }}
          >
            {todo.status ? <Chip size="small" variant="outlined" label={todo.status} /> : null}
            <Typography variant="body2">
              {todo.title ?? t('widgets.deepwiki.chat.untitledStep', 'Untitled step')}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
});
