/**
 * DrawerPage — full-height flex container for tab content. Ported from
 * `apps/elitea-ui/src/[fsd]/features/settings/ui/drawer-page/DrawerPage.jsx`.
 *
 * This file used to hold a second port of the same baseline component: same
 * name, same five style properties, no `children` prop, and no consumer. The
 * copy that eleven pages really render lived in
 * `features/settings/ui/drawer-page/DrawerPage.tsx`, reachable only through
 * `features/settings/index.ts` because `pages/` may enter a feature slice
 * through its `index.ts` only. That barrel imports every settings subdomain at
 * module scope, so ten admin pages asking for a `<Box>` pulled the whole
 * settings slice — CodeMirror included — into one shared admin chunk of
 * 391.6 KiB gzip, over the 250 KiB route-chunk budget of spec §3.5 (issue
 * #493).
 *
 * The working copy now lives here, and the stub is gone. This is the layer the
 * component always belonged in: it has no entity, widget or feature
 * dependency, which is exactly what this barrel's own header asks for.
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
