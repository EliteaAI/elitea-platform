import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { MAX_CONVERSATION_STARTERS } from '@/shared/lib/limits';

import { conversationStartersToStrings } from '../lib/conversationStarters.helpers';
import { EllipsisTextWithTooltip } from './EllipsisTextWithTooltip';

export interface ChatConversationStartersProps {
  /** Baseline prop name: `conversation_starters`. Typically `useConversationStarters`'s own `displayedConversationStarters` result (this slice's `lib/`). */
  readonly conversationStarters: readonly unknown[] | undefined;
  readonly onSend: (starter: string) => void;
}

function gridSx(startersCount: number): SxProps<Theme> {
  return {
    display: 'grid',
    width: '100%',
    maxWidth: '100%',
    height: 'auto',
    boxSizing: 'border-box',
    gap: '0.5rem',
    padding: '0.5rem',
    overflow: 'hidden',
    ...(startersCount <= 3 ? { gridTemplateColumns: `repeat(${startersCount}, 1fr)` } : {}),
    ...(startersCount === MAX_CONVERSATION_STARTERS
      ? { gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' }
      : {}),
  };
}

const starterItemSx: SxProps<Theme> = {
  height: 'auto',
  minHeight: '2.5rem',
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  boxSizing: 'border-box',
  overflow: 'hidden',
};

const starterTextSx: SxProps<Theme> = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/**
 * Ported from `apps/elitea-ui/src/pages/NewChat/ChatConversationStarters.jsx`
 * — the empty-chat grid of clickable starter prompts. Renders nothing
 * (baseline: `if (filteredStarters.length === 0) return null`) when there
 * are no non-blank starters to show.
 *
 * Deviation: the baseline rendered the ORIGINAL (possibly non-string)
 * array entry as `text` after only using its stringified form to decide
 * whether to keep/drop it (`filteredStarters` keeps the raw item;
 * `EllipsisTextWithTooltip`'s `text` prop is untyped JS). This port maps to
 * the stringified form directly (`conversationStartersToStrings`) since
 * `EllipsisTextWithTooltip.text` is typed `string` here — no observable
 * difference for real data (starters are always persisted as strings by
 * the agent-editor form field, `features/agents`' `ConversationStarters`).
 *
 * Grid CSS (`gridSx`) is copied verbatim from the baseline's inline
 * `chatConversationStartersStyles`, including its `MAX_CONVERSATION_STARTERS`
 * (4) special case for a 2x2 layout — `shared/lib/limits.ts` already ports
 * that constant (unit S3), used here instead of a re-declared literal `4`.
 */
export function ChatConversationStarters({ conversationStarters, onSend }: ChatConversationStartersProps): ReactNode {
  const handleClick = useCallback(
    (starter: string) => () => {
      onSend(starter);
    },
    [onSend],
  );

  const filteredStarters = useMemo(
    () => conversationStartersToStrings(conversationStarters).filter((starter) => starter.trim().length > 0),
    [conversationStarters],
  );

  if (filteredStarters.length === 0) return null;

  return (
    <Box sx={gridSx(filteredStarters.length)}>
      {filteredStarters.map((starter, index) => (
        <EllipsisTextWithTooltip
          key={index}
          text={starter}
          onClick={handleClick(starter)}
          sx={starterItemSx}
          textSx={starterTextSx}
        />
      ))}
    </Box>
  );
}
