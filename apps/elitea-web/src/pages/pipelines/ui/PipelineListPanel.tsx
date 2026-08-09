import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { BaseBtn } from '@/shared/ui/BaseBtn';
import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

/**
 * Shared row-rendering surface for `Latest`/`MyLiked`/`Trending`/
 * `PrivatePipelinesList` (this unit, A2m) — the data-bearing replacement for
 * the baseline's `CardList` (`apps/elitea-ui/src/components/CardList.jsx`)
 * for THESE four pages' purposes only. Same disclosed-scope-reduction shape
 * `pages/agents/ui/ApplicationListPanel.tsx` (Wave-2 unit A1g) already
 * established for the sibling agents domain — `CardList` itself (card grid,
 * drag handles, per-card menus, infinite-scroll sentinel, the `Categories`/
 * `TrendingAuthors` right rail) has no confirmed `shared/ui`/`widgets` port
 * and is out of this unit's ownership fence to add. This renders the same
 * rows as a plain, accessible list plus a "Load more" button instead of a
 * card grid, and drops the tag-filter/trending-authors side panel entirely.
 *
 * A page-owned component (`pages/pipelines/ui/`), not `features/` or
 * `entities/` — it holds no fetching or domain logic of its own.
 *
 * Deliberately a near-duplicate of `pages/agents/ui/ApplicationListPanel.tsx`
 * rather than a shared import: `pages/` is not a depcruise-sliced layer (no
 * `no-sideways-pages` rule exists), so importing it directly would be
 * technically legal, but `pages/agents` and `pages/pipelines` are two
 * independently-landing Wave-2 sub-units with no ownership relationship to
 * each other — coupling one page slice's internals to another's private
 * `ui/` directory would make either impossible to evolve or delete on its
 * own, the same "each page-owned surface is independently
 * deletable/replaceable" posture this codebase's `pages/user-public/ui/`
 * precedent already established.
 */
export interface PipelineListRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface PipelineListPanelProps {
  readonly rows: readonly PipelineListRow[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly errorMessage: string;
  readonly emptyTitle: ReactNode;
  readonly emptyDescription: ReactNode;
  readonly onSelect: (id: string) => void;
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  readonly onLoadMore: () => void;
}

export function PipelineListPanel({
  rows,
  isLoading,
  isError,
  errorMessage,
  emptyTitle,
  emptyDescription,
  onSelect,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: PipelineListPanelProps): ReactNode {
  if (isLoading) {
    return <Typography variant="bodyMedium">{t('pages.pipelines.list.loading', 'Loading…')}</Typography>;
  }
  if (isError) {
    return (
      <Typography
        role="alert"
        variant="bodyMedium"
      >
        {errorMessage}
      </Typography>
    );
  }
  if (rows.length === 0) {
    return (
      <NoResultsMessage
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }
  return (
    <Box sx={containerSx}>
      <List>
        {rows.map((row) => (
          // <ListItem disablePadding> wrapper: see ApplicationListPanel for why
          // `component="li"` on the button is not the fix.
          <ListItem
            key={row.id}
            disablePadding
          >
            <ListItemButton
              data-testid="pipeline-list-row"
              onClick={() => {
                onSelect(row.id);
              }}
            >
              <ListItemText
                primary={row.name}
                secondary={row.description}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      {hasMore && (
        <BaseBtn
          variant="secondary"
          disabled={isLoadingMore}
          onClick={onLoadMore}
        >
          {t('pages.pipelines.list.loadMore', 'Load more')}
        </BaseBtn>
      )}
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
});
