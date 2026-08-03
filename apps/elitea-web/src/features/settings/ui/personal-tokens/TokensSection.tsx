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
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { TokensTable } from './TokensTable';
import type { PersonalAccessToken } from '@/entities/token';

export interface TokensSectionProps {
  /** Currently-selected project id — threaded down from the route. */
  projectId: string;
  /** Search query to filter token names. */
  search: string;
  /** Whether to show the "preview settings" button. */
  showPreview?: boolean;
  /** Callback when user clicks "Preview settings" on a token row. */
  onPreviewToken?: (token: PersonalAccessToken) => void;
}

export const TokensSection = memo(function TokensSection({
  projectId,
  search,
  showPreview = false,
  onPreviewToken,
}: TokensSectionProps) {
  const styles = getStyles();

  return (
    <Box sx={styles.container}>
      <Box sx={styles.tableWrapper}>
        <TokensTable
          projectId={projectId}
          search={search}
          showPreview={showPreview}
          {...(onPreviewToken ? { onPreviewToken } : {})}
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
