import { memo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { combineSx } from '../lib/combineSx';

export interface DrawerPageProps {
  sx?: SxProps<Theme>;
}

/**
 * Minimal full-height wrapper for settings page content. Ported from
 * `apps/elitea-ui/src/[fsd]/features/settings/ui/drawer-page/DrawerPage.jsx`.
 */
export const DrawerPage = memo(function DrawerPage({ sx }: DrawerPageProps) {
  return (
    <Box
      sx={combineSx(pageSx, sx)}
    />
  );
});

/** @type {MuiSx} */
const pageSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  overflow: 'scroll',
};
