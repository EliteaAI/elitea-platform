/**
 * ROUTE-057 `/settings/tokens` -> `PersonalTokens` page.
 *
 * Replaces the stub `RouteShell` with the full personal tokens management UI.
 * Composes:
 *  - `DrawerPageHeader` with search + "Generate" button
 *  - `TokensSection` for the token table (with optional search filtering)
 *  - Empty state when no tokens exist
 *
 * Deviations from the baseline:
 *  - No `Split` layout (SettingsPreview not inline — Wave-2 concern)
 *  - No tour IDs
 * - No Redux (no sidebar state)
 *  - No model/configuration data fetching
 *  - Uses `useNavigate` from TanStack Router for nav to create-personal-token
 */
import { useCallback, useState } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useNavigate } from '@tanstack/react-router';

import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { TokensSection } from '@/routes/_shell/settings/personal-tokens/TokensSection';
import { t } from '@/shared/ui/lib/t';
import { useListTokensQuery } from '@/entities/token/api/tokenApi';
import { useSelectedProjectStore } from '@/widgets/app-shell';

export function PersonalTokensPage() {
  const navigate = useNavigate();
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');
  const { data: tokens = [], isFetching } = useListTokensQuery({
    enabled: !!projectId,
  });
  const [search, setSearch] = useState('');
  const styles = getStyles();

  /* ── navigation to create page ──────────────────────────────────────── */

  const onAddPersonalToken = useCallback(() => {
    void navigate({ to: '/settings/create-personal-token' });
  }, [navigate]);

  /* ── preview callback ───────────────────────────────────────────────── */

  const onPreviewToken = useCallback(
    (token: { uuid: string; name: string; token: string }) => {
      // TODO: Open inline SettingsPreview panel (split layout — Wave-2 concern)
      // eslint-disable-next-line no-console
      console.log('Preview token:', token.name);
    },
    [],
  );

  /* ── empty state ────────────────────────────────────────────────────── */

  if (isFetching) {
    return (
      <Box sx={styles.loadingContainer}>
        <CircularProgress />
      </Box>
    );
  }

  if (tokens.length === 0) {
    return (
      <Box sx={styles.emptyStateContainer}>
        <Typography
          variant="headingMedium"
          color="text.secondary"
        >
          {t('entities.token.emptyState.title', 'No tokens yet')}
        </Typography>
        <Typography
          variant="bodyMedium"
          color="text.secondary"
          sx={styles.emptyStateDesc}
        >
          {t('entities.token.emptyState.description', 'Create your first API token.')}
        </Typography>
        <Paper
          elevation={0}
          sx={styles.emptyStateButton}
          onClick={onAddPersonalToken}
        >
          {t('entities.token.emptyState.createButton', 'Create token')}
        </Paper>
      </Box>
    );
  }

  /* ── main content ───────────────────────────────────────────────────── */

  return (
    <Paper
      elevation={0}
      sx={styles.root}
    >
      <DrawerPageHeader
        title={t('entities.token.pageTitle', 'Personal Tokens')}
        showSearchInput
        showAddButton
        slotProps={{
          searchInput: {
            search,
            onChangeSearch: setSearch,
            placeholder: t('entities.token.searchPlaceholder', 'Search tokens...'),
          },
          addButton: {
            onAdd: onAddPersonalToken,
            tooltip: t('entities.token.addTooltip', 'Generate new token'),
          },
        }}
      />
      <Box sx={styles.content}>
        <TokensSection
          search={search}
          showPreview
          onPreviewToken={onPreviewToken}
        />
      </Box>
    </Paper>
  );
}

const getStyles = (): {
  root: SxProps<Theme>;
  content: SxProps<Theme>;
  loadingContainer: SxProps<Theme>;
  emptyStateContainer: SxProps<Theme>;
  emptyStateDesc: SxProps<Theme>;
  emptyStateButton: SxProps<Theme>;
} => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    borderRadius: 0,
  },
  content: {
    flex: 1,
    minHeight: 0,
    padding: '0 1.5rem 1.5rem',
  },
  loadingContainer: {
    height: '50vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    flex: 1,
    padding: '2rem',
  },
  emptyStateDesc: {
    marginBottom: '1rem',
  },
  emptyStateButton: {
    padding: '0.5rem 1.5rem',
    borderRadius: 4,
    cursor: 'pointer',
    backgroundColor: 'primary.main',
    color: 'white',
    fontWeight: 600,
  },
});
