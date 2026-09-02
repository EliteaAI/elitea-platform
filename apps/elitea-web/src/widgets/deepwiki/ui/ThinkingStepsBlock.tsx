/**
 * One run's thinking log: the cards the stream produced while an answer was
 * being written.
 *
 * COLLAPSED BY DEFAULT and expandable, because the log is context and the
 * answer is the content. The legacy drawer opened it while the run was live and
 * left it open afterwards, so a long conversation became a wall of tool calls
 * with the answers buried between them.
 */
import { memo, useState } from 'react';

import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { StyledAccordion } from '@/shared/ui/StyledAccordion';
import { StyledAccordionDetails } from '@/shared/ui/StyledAccordionDetails';
import { StyledAccordionSummary } from '@/shared/ui/StyledAccordionSummary';
import type { ChatThinkingBlock, ChatThinkingStep } from '@/features/wiki-chat';

export interface ThinkingStepsBlockProps {
  readonly block: ChatThinkingBlock;
}

/** The event names that get a chip of their own; everything else is a line. */
const TOOL_EVENTS = new Set(['tool_start', 'tool_end']);

/** The inline spinner's size, in the theme's spacing unit rather than a bare pixel count. */
const PROGRESS_SIZE = '0.75rem';

function stepLabel(step: ChatThinkingStep): string {
  return step.message === '' ? step.event : step.message;
}

const StepRow = memo(function StepRow({ step }: { readonly step: ChatThinkingStep }) {
  if (step.event === 'llm_thinking') {
    return (
      <Stack sx={{ flexDirection: 'row', gap: 1, alignItems: 'center' }}>
        <CircularProgress size={PROGRESS_SIZE} />
        <Typography variant="bodySmall" color="text.secondary">
          {stepLabel(step)}
        </Typography>
      </Stack>
    );
  }

  if (TOOL_EVENTS.has(step.event)) {
    return (
      <Stack sx={{ flexDirection: 'row', gap: 1, alignItems: 'center' }}>
        <Chip
          size="small"
          variant="outlined"
          // The DONE state is the one worth colouring: a card that never
          // reaches tool_end is a tool still running or a tool that died, and
          // both are things the user should be able to see at a glance.
          color={step.event === 'tool_end' ? 'success' : 'default'}
          label={step.event === 'tool_end' ? t('widgets.deepwiki.chat.toolDone', 'Done') : t('widgets.deepwiki.chat.toolRunning', 'Running')}
        />
        <Typography variant="bodySmall" sx={{ wordBreak: 'break-word' }}>
          {stepLabel(step)}
        </Typography>
      </Stack>
    );
  }

  return (
    <Typography variant="bodySmall" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
      {stepLabel(step)}
    </Typography>
  );
});

export const ThinkingStepsBlock = memo(function ThinkingStepsBlock({
  block,
}: ThinkingStepsBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const running = block.status === 'running';

  return (
    <StyledAccordion
      data-testid="wiki-chat-thinking-block"
      expanded={expanded}
      onChange={(_event, next) => {
        setExpanded(next);
      }}
      slotProps={{ transition: { unmountOnExit: true } }}
      sx={{ my: 1 }}
    >
      <StyledAccordionSummary>
        <Stack sx={{ flexDirection: 'row', gap: 1, alignItems: 'center' }}>
          {running ? <CircularProgress size={PROGRESS_SIZE} /> : null}
          <Typography variant="bodySmall" color="text.secondary">
            {running
              ? t('widgets.deepwiki.chat.thinking', 'Working…')
              : t('widgets.deepwiki.chat.thinkingSteps', 'Steps')}
            {` (${String(block.steps.length)})`}
          </Typography>
        </Stack>
      </StyledAccordionSummary>
      <StyledAccordionDetails>
        <Stack sx={{ gap: 0.5, pl: 1, borderLeft: 1, borderColor: 'divider' }}>
          {block.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </Stack>
      </StyledAccordionDetails>
    </StyledAccordion>
  );
});
