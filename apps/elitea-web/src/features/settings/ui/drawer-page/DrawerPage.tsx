/**
 * DrawerPage — full-height flex container for tab content.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/drawer-page/DrawerPage.jsx`.
 */
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface DrawerPageProps {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
  [key: string]: unknown;
}

export function DrawerPage({ children, ...rest }: DrawerPageProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'scroll',
        ...(rest.sx as Record<string, unknown> | undefined),
      }}
      {...Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'sx'))}
    >
      {children}
    </Box>
  );
}
