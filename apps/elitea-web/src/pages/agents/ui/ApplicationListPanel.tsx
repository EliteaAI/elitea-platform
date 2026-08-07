import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { t } from '@/shared/i18n';

/**
 * Shared row-rendering surface for `Latest`/`MyLiked`/`Trending`/
 * `PrivateAgentsList` (this unit, A1g) — the data-bearing replacement for
 * the baseline's `CardList` (`apps/elitea-ui/src/components/CardList.jsx`)
 * for THESE four pages' purposes only, same disclosed-scope-reduction shape
 * `pages/user-public/ui/EntityListPanel.tsx` and `pages/credentials/
 * CredentialsList.tsx` already established for this exact situation:
 * `CardList` itself (card grid, drag handles, per-card menus, infinite-
 * scroll sentinel, the `Categories`/`TrendingAuthors` right rail) has no
 * confirmed `shared/ui`/`widgets` port and is out of this unit's ownership
 * fence to add. This renders the same rows as a plain, accessible list plus
 * a "Load more" button instead of a card grid, and drops the tag-filter/
 * trending-authors side panel entirely.
 *
 * A page-owned component (`pages/agents/ui/`), not `features/` or
 * `entities/` — it holds no fetching or domain logic of its own, purely
 * list layout + empty/loading/error states, matching spec §3.3's
 * "pages/ = layout + slot composition" rule extended down into this
 * directory the same way `pages/user-public/ui/` already does.
 */
export interface ApplicationListRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface ApplicationListPanelProps {
  readonly rows: readonly ApplicationListRow[];
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

export function ApplicationListPanel({
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
}: ApplicationListPanelProps): ReactNode {
  if (isLoading) {
    return <Typography variant="bodyMedium">{t('pages.agents.list.loading', 'Loading…')}</Typography>;
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
          // <ListItem disablePadding> wrapping <ListItemButton> — MUI's own
          // pattern, and the one `features/skills/ui/SkillsList.tsx` already
          // uses. List emits a <ul>, and ListItemButton defaults to a
          // <div role="button">, which axe's `list` rule rejects as a direct
          // child (impact: serious). Putting `component="li"` on the BUTTON
          // instead only trades that for `aria-allowed-role` — an <li> may not
          // carry role="button". The wrapper gives a real <li> with the button
          // inside it, which satisfies both.
          <ListItem
            key={row.id}
            disablePadding
          >
            <ListItemButton
              data-testid="application-list-row"
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
          {t('pages.agents.list.loadMore', 'Load more')}
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
