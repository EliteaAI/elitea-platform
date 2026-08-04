import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';

import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';
import { t } from '@/shared/i18n';

import type { UserPublicListItem } from '../lib/types';

import { AuthorNames } from './AuthorNames';

/**
 * Presentational list panel — the data-bearing replacement for the
 * baseline's `CardList` (`apps/elitea-ui/src/components/CardList.jsx`) for
 * THIS page's purposes only. `CardList` itself (grid/list view toggle,
 * infinite-scroll sentinel, per-card menus, drag handles, `RightInfoPanel`
 * tag sidebar) is a large, cross-domain, `src/components/`-layer ("legacy")
 * component never ported to `shared/ui`'s S1 set and outside this unit's
 * ownership fence to add — flagged in the A12 report. This renders the same
 * underlying data as an accessible, unstyled-card list instead of a fully
 * visually-equivalent grid.
 *
 * Each card is a real `ListItemButton` (a real interactive element, R-C1 —
 * same "not a `Box` + `onClick`" rule `widgets/sidebar/ui/SidebarNavItem.tsx`
 * documents) that reports the clicked item back through `onSelect`, rather
 * than resolving a route itself: this component stays pure presentation +
 * a callback, exactly the split `pages/agents/ui/ApplicationListPanel.tsx`
 * already established for the identical "CardList replacement" scope (that
 * file's own doc comment names this component as its sibling). The actual
 * `useNavigate()` call, and the per-`kind` route it picks, lives in this
 * item's composing panel (`AllStuffPanel`/`ApplicationsPanel`) — this file
 * does not need router knowledge or a `<RouterProvider>` in its own tests.
 * Fixes the A12-ui adversarial-review finding that these cards were fully
 * inert (no `Link`/`useNavigate`/`onClick` reached an item's detail page).
 */
export interface EntityListPanelProps {
  readonly items: readonly UserPublicListItem[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly emptyTitle: string;
  readonly errorMessage: string;
  readonly loadingMessage: string;
  readonly onSelect: (item: UserPublicListItem) => void;
}

export function EntityListPanel({
  items,
  isLoading,
  isError,
  emptyTitle,
  errorMessage,
  loadingMessage,
  onSelect,
}: EntityListPanelProps): ReactNode {
  if (isLoading) {
    return <output>{loadingMessage}</output>;
  }
  if (isError) {
    return <div role="alert">{errorMessage}</div>;
  }
  if (items.length === 0) {
    return (
      <NoResultsMessage
        title={emptyTitle}
        description={t('userPublic.emptyDescription', 'Try a different search or filter.')}
      />
    );
  }
  return (
    <Box
      component="ul"
      sx={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      {items.map((item) => (
        <Box
          key={item.id}
          component="li"
        >
          <ListItemButton
            onClick={() => {
              onSelect(item);
            }}
            sx={(theme) => ({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: theme.spacing(0.5),
              border: `1px solid ${theme.vars.palette.divider}`,
              borderRadius: theme.vars.shape.radiusMd,
              padding: theme.spacing(2),
            })}
          >
            <Typography variant="headingSmall">{item.name}</Typography>
            {item.description !== '' && <Typography variant="bodyMedium">{item.description}</Typography>}
            <AuthorNames names={item.authorNames} />
          </ListItemButton>
        </Box>
      ))}
    </Box>
  );
}
