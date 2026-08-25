/**
 * The three screens the personal-token list shows INSTEAD of its rows: no
 * personal project, a failed read, and a first load still in flight.
 *
 * DEFECT this exists to close: `PersonalTokens.tsx` branched on
 * `tokens.length === 0` alone, so a failed read rendered the headline "No
 * tokens yet" over a user's real, unreadable tokens. `eliteaFetch` throws on
 * a non-2xx answer, the query settles as `isError: true, data: undefined`,
 * and nothing upstream surfaces that — the query client sets no
 * `throwOnError`, and the route's `errorComponent` only catches thrown
 * render/loader errors.
 *
 * Lives in `routes/-ui/` — the `-`-prefixed helper convention TanStack's
 * generator ignores — for the same reason `TokenProjectNotice.tsx` does:
 * pulling it out is what keeps the route page inside the §3.5 file-length
 * and complexity budgets.
 */
import type { ReactElement } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { EliteaApiError } from '@/shared/api/generated/mutator';
import { t } from '@/shared/i18n';

/** `true` when the token service answered 503 — it is switched off, not busy. */
function isTokenServiceUnavailable(error: unknown): boolean {
  if (!(error instanceof EliteaApiError)) return false;
  const { failure } = error;
  return (failure.kind === 'http' || failure.kind === 'auth') && failure.status === 503;
}

/** What to tell the user about a token list that did not load. */
function tokenListErrorMessage(error: unknown): string {
  if (isTokenServiceUnavailable(error)) {
    return t('entities.token.form.serviceUnavailable', 'Personal tokens are turned off on this deployment. Ask your administrator to configure the token service.');
  }
  return t('entities.token.loadError', 'Your tokens did not load. This list is not complete.');
}

export interface TokenListStatusProps {
  /** The user's personal project. The list query is gated on it. */
  readonly personalProjectId: string | undefined;
  readonly isError: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly containerSx: SxProps<Theme>;
  readonly buttonSx: SxProps<Theme>;
  readonly loadingSx: SxProps<Theme>;
}

/**
 * Order matters. A DISABLED TanStack query reports `isPending: true` and
 * `isError: false`, so the no-personal-project case must be answered before
 * the pending one or the page spins forever.
 *
 * A 503 gets its own line and NO retry button: it means the deployment has
 * no APPLICATION_SECRET_KEY, which no amount of retrying can change — the
 * same call `TokenProjectNotice.tsx` already made for the create form.
 */
export function TokenListStatus({ personalProjectId, isError, error, onRetry, containerSx, buttonSx, loadingSx }: TokenListStatusProps): ReactElement {
  if (!personalProjectId) {
    return (
      <Box sx={containerSx}>
        <Typography
          variant="bodyMedium"
          color="error"
          role="alert"
        >
          {t('entities.token.noPersonalProject', 'You have no personal project, so your tokens cannot be listed. Ask your administrator to create one.')}
        </Typography>
      </Box>
    );
  }

  if (isError) {
    return (
      <Box sx={containerSx}>
        <Typography
          variant="bodyMedium"
          color="error"
          role="alert"
        >
          {tokenListErrorMessage(error)}
        </Typography>
        {!isTokenServiceUnavailable(error) && (
          <Paper
            elevation={0}
            sx={buttonSx}
            onClick={onRetry}
          >
            {t('entities.token.retry', 'Try again')}
          </Paper>
        )}
      </Box>
    );
  }

  return (
    <Box sx={loadingSx}>
      <CircularProgress />
    </Box>
  );
}
