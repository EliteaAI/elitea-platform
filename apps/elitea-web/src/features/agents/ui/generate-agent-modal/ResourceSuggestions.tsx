import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import type { SuggestedResource } from '../../lib/agentDraft';
import { SuggestionItem, type SuggestionItemProps } from './SuggestionItem';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/generate-agent-modal/ResourceSuggestions.jsx`.
 */
export interface ResourceSuggestionsProps {
  readonly title: string;
  readonly items: readonly SuggestedResource[] | undefined;
  readonly selectedIds: ReadonlySet<number | string>;
  readonly onToggle: (id: number | string) => void;
  readonly entityType: SuggestionItemProps['entityType'];
}

export function ResourceSuggestions({
  title,
  items,
  selectedIds,
  onToggle,
  entityType,
}: ResourceSuggestionsProps): ReactNode {
  if (!items?.length) return null;

  return (
    <Box sx={containerSx}>
      <Typography
        variant="subtitle"
        sx={titleSx}
      >
        {title}
      </Typography>
      <Box sx={listSx}>
        {items.map((item) => (
          <SuggestionItem
            key={item.id}
            item={item}
            checked={selectedIds.has(item.id)}
            onToggle={onToggle}
            entityType={entityType}
          />
        ))}
      </Box>
    </Box>
  );
}

const containerSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: '1rem', paddingTop: '0.5rem' };

const titleSx: SxProps<Theme> = { color: 'text.primary' };

const listSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: '0.5rem' };
