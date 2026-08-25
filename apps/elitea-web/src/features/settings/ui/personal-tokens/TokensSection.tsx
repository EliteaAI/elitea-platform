/**
 * Container for the tokens table with search filtering.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/personal-tokes/
 * TokensSection.jsx`.
 *
 * Deviations:
 *  - No Redux (no sidebar state)
 *  - No tour IDs
 *  - Passes search prop to TokensTable for filtering (data is fetched there)
 *  - No `projectId` prop: personal tokens are not project-scoped
 *    (`/auth/token/` takes no project param) — `TokensTable` resolves the
 *    user's `personal_project_id` itself (Warning #11)
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { TokensTable } from './TokensTable';
import type { PersonalAccessToken } from '@/entities/token';

export interface TokensSectionProps {
  /** Search query to filter token names. */
  search: string;
  /** Whether to show the "preview settings" button. */
  showPreview?: boolean;
  /** Callback when user clicks "Preview settings" on a token row. */
  onPreviewToken?: (token: PersonalAccessToken) => void;
  /** Project id -> name for the binding column — see `TokensTable`. */
  projectNames?: ReadonlyMap<string, string>;
}

export const TokensSection = memo(function TokensSection({
  search,
  showPreview = false,
  onPreviewToken,
  projectNames,
}: TokensSectionProps) {
  const styles = getStyles();

  return (
    <Box sx={styles.container}>
      <Box sx={styles.tableWrapper}>
        <TokensTable
          search={search}
          showPreview={showPreview}
          {...(onPreviewToken ? { onPreviewToken } : {})}
          {...(projectNames ? { projectNames } : {})}
        />
      </Box>
    </Box>
  );
});

const getStyles = (): {
  container: SxProps<Theme>;
  tableWrapper: SxProps<Theme>;
} => ({
  container: {
    width: '100%',
    minWidth: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  tableWrapper: {
    flex: 1,
    minHeight: 0,
  },
});
