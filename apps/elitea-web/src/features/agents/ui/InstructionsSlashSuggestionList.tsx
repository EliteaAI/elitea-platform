import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import Box from '@mui/material/Box';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { MentionToolItem } from '@/shared/ui/MentionToolItem';
import { MentionToolList, type MentionTool } from '@/shared/ui/MentionToolList';

import { MentionPhase, type MentionPhaseValue } from '../lib/constants/mention.constants';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/
 * configurations/input/InstructionsSlashSuggestionList.jsx`.
 *
 * **Not currently wired into `InstructionsInput.tsx`** — see that file's own
 * module doc comment ("What this does NOT reproduce" paragraph): the
 * interactive mention state machine that would drive `phase`/
 * `highlightedIndex`/etc is sibling A1b's `useInstructionsMention`/
 * `useInstructionsSkillMention` (`../lib/constants/mention.constants.ts`'s
 * own doc comment names both in "this sub-unit's owned-file list"), not
 * landed in this worktree as of this file being written. This component is
 * still ported here, fully and faithfully, as the presentational dropdown
 * that hook pair is expected to drive once it lands — a pure function of
 * its props, with no dependency on the missing hooks itself.
 *
 * `Mention.MentionToolList`/`Mention.MentionToolItem` (baseline namespace
 * import) map to this app's real `shared/ui/MentionToolList`/
 * `MentionToolItem` (unit S1-G) — `MentionToolList` already composes its
 * own `MentionToolItem` rows internally for the `tools` phase, so only the
 * `items` phase (toolkit/mcp/agent/pipeline mention targets) renders
 * `MentionToolItem` rows directly here, matching the baseline's own
 * structure exactly.
 *
 * **Real, disclosed prop drop:** the baseline's `committedMentions` prop
 * fed `MentionToolItem`'s `isSelected` (a "you already mentioned this"
 * checkmark). `shared/ui/MentionToolItem.tsx`'s real prop type
 * (`label`/`description`/`icon`/`onClick`/`isHighlighted`/`data-testid`) has
 * no `isSelected` — that indicator was not ported by unit S1-G. Rather than
 * accept a prop this component cannot visually honour, `committedMentions`
 * is dropped from this port's surface entirely; a caller relying on it for
 * anything beyond visual feedback (there is none in the baseline) loses
 * nothing functional.
 */
interface InstructionsSlashMentionItem {
  readonly name: string;
  readonly description?: string | undefined;
  readonly isToolkit?: boolean | undefined;
}

export interface InstructionsSlashSuggestionListProps {
  readonly phase: MentionPhaseValue;
  readonly filteredItems: readonly InstructionsSlashMentionItem[];
  readonly filteredTools: readonly MentionTool[];
  readonly selectedItem: InstructionsSlashMentionItem | undefined;
  readonly highlightedIndex: number;
  readonly onSelectItem: (item: InstructionsSlashMentionItem, isToolkit: boolean) => void;
  readonly onSelectTool: (toolName: string | null) => void;
  readonly onClose: () => void;
}

export function InstructionsSlashSuggestionList({
  phase,
  filteredItems,
  filteredTools,
  selectedItem,
  highlightedIndex,
  onSelectItem,
  onSelectTool,
  onClose,
}: InstructionsSlashSuggestionListProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || highlightedIndex < 0) return;
    const container = containerRef.current;
    const highlighted = container.querySelector('[data-highlighted="true"]');
    if (!highlighted) return;
    const stickyHeader = container.firstElementChild;
    const headerHeight = stickyHeader instanceof HTMLElement ? stickyHeader.offsetHeight : 0;
    const containerRect = container.getBoundingClientRect();
    const itemRect = highlighted.getBoundingClientRect();
    const itemTopRelative = itemRect.top - containerRect.top;
    const itemBottomRelative = itemRect.bottom - containerRect.top;
    if (itemTopRelative < headerHeight) {
      container.scrollTop += itemTopRelative - headerHeight;
    } else if (itemBottomRelative > container.clientHeight) {
      container.scrollTop += itemBottomRelative - container.clientHeight;
    }
  }, [highlightedIndex]);

  if (phase === MentionPhase.Idle) return null;

  if (phase === MentionPhase.Tools) {
    if (filteredTools.length === 0) return null;
    return (
      <MentionToolList
        tools={[...filteredTools]}
        toolkitName={selectedItem?.name ?? ''}
        onSelectTool={onSelectTool}
        highlightedIndex={highlightedIndex}
      />
    );
  }

  if (filteredItems.length === 0) return null;

  return (
    <ClickAwayListener onClickAway={onClose}>
      <Box
        ref={containerRef}
        sx={containerSx}
      >
        <Box sx={headerSx}>
          <Typography
            variant="subtitle"
            color="text.primary"
          >
            {t('features.agents.instructionsSlashSuggestionList.header', 'Mention toolkit, mcp, agent or pipeline')}
          </Typography>
        </Box>
        {filteredItems.map((item, index) => (
          <MentionToolItem
            key={item.name}
            label={item.name}
            {...(item.description !== undefined ? { description: item.description } : {})}
            onClick={() => onSelectItem(item, item.isToolkit ?? true)}
            isHighlighted={index === highlightedIndex}
          />
        ))}
      </Box>
    </ClickAwayListener>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  border: `1px solid ${theme.vars.palette.border.lines}`,
  width: '100%',
  maxWidth: '100%',
  maxHeight: '15.4375rem',
  borderRadius: theme.vars.shape.radiusLg,
  boxSizing: 'border-box',
  padding: '0.75rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  background: theme.vars.palette.background.secondary,
  overflowY: 'auto',
});

const headerSx: SxProps<Theme> = {
  position: 'sticky',
  top: '-0.75rem',
  zIndex: 1,
  height: '1rem',
  display: 'flex',
  alignItems: 'center',
  padding: '1rem 0.75rem',
  margin: '-0.75rem -0.75rem 0',
  background: 'inherit',
};
