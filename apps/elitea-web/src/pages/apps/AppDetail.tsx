import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

import { useParams } from '@tanstack/react-router';

import { appDetailErrorMessage, useAppDetail } from '@/features/apps';
import { t } from '@/shared/i18n';

const loadingContainerSx = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: '25rem',
};

const errorContainerSx = {
  p: '1.5rem',
};

const iframeContainerSx = {
  width: '100%',
  height: '100vh',
  overflow: 'hidden',
  position: 'relative' as const,
};

const iframeSx = {
  width: '100%',
  height: '100%',
  border: 'none',
  display: 'block',
};

interface AppDetailRouteParams {
  readonly appId?: string;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/pages/apps/AppDetail.jsx` — covers
 * ROUTE-040 (`/apps/:tab/:appId`). Also the target of ROUTE-046
 * (`/user-public/apps/:appId`, unit A12's `src/pages/user-public/**`
 * domain) — the baseline renders the identical `<AppDetail/>` component
 * for both routes, so this same export is this port's answer for both once
 * both route files are wired to real page content (routing wiring itself
 * is `src/routes/**`, unit R1's exclusive ownership, not this unit's — see
 * the final report).
 *
 * **Composition gap, not a placeholder:** the baseline's non-custom-UI
 * fallback renders `<EditToolkit/>` (`pages/Toolkits/EditToolkit`,
 * `features/toolkits`'/`pages/toolkits`' ownership, unit A4 — not landed).
 * The loading/error/custom-UI-iframe branches above it are fully ported
 * and functional; only the terminal fallback is an intentionally empty
 * composition slot (see `useAppDetail`'s own doc comment for why
 * `hasCustomUI` is `false` for essentially every real app on the current
 * Go backend, making this fallback the common case today, not an edge
 * case).
 */
export function AppDetail() {
  const params = useParams({ strict: false }) as AppDetailRouteParams;
  const { appName, isFetching, isError, error, iframeUrl, iframeKey, hasCustomUI } = useAppDetail(params.appId);

  if (isFetching) {
    return (
      <Box sx={loadingContainerSx}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError) {
    return (
      <Box sx={errorContainerSx}>
        <Alert severity="error">{appDetailErrorMessage(error)}</Alert>
      </Box>
    );
  }

  if (hasCustomUI && iframeUrl !== null) {
    return (
      <Box sx={iframeContainerSx}>
        <iframe
          key={iframeKey}
          src={iframeUrl}
          style={iframeSx}
          title={t('apps.appDetail.iframeTitle', '{{appName}} Custom UI', { appName })}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      </Box>
    );
  }

  // Composition gap: `pages/toolkits`' `EditToolkit` (unit A4) has not
  // landed — see this file's own doc comment.
  return <Box data-testid="app-detail-edit-toolkit-slot" />;
}
