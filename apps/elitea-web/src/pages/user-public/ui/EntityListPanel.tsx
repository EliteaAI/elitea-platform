import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
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
 */
export interface EntityListPanelProps {
  readonly items: readonly UserPublicListItem[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly emptyTitle: string;
  readonly errorMessage: string;
  readonly loadingMessage: string;
}

export function EntityListPanel({
  items,
  isLoading,
  isError,
  emptyTitle,
  errorMessage,
  loadingMessage,
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
          sx={(theme) => ({
            border: `1px solid ${theme.vars.palette.divider}`,
            borderRadius: theme.vars.shape.radiusMd,
            padding: theme.spacing(2),
          })}
        >
          <Typography variant="headingSmall">{item.name}</Typography>
          {item.description !== '' && <Typography variant="bodyMedium">{item.description}</Typography>}
          <AuthorNames names={item.authorNames} />
        </Box>
      ))}
    </Box>
  );
}
