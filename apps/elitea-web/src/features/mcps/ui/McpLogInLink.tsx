/**
 * Port of apps/elitea-ui/src/[fsd]/features/mcp/ui/McpLogInLink.jsx (unit
 * A5, manifest COPY-142). An inline, underlined-text login trigger (vs.
 * `McpLogInButton`'s real button), for contexts like a participant list row.
 */
import type { ReactNode } from 'react';

import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';

import type { McpAuthModalValues } from '../model/useMcpAuthModal';
import { useMcpLogin } from '../model/useMcpLogin';

import { McpAuthModal } from './McpAuthModal';

export interface McpLogInLinkProps {
  values: McpAuthModalValues;
  onSuccess?: (() => void) | undefined;
  sx?: SxProps<Theme> | undefined;
  title?: string | undefined;
  projectId?: string | number | undefined;
}

const linkSx: SxProps<Theme> = {
  textDecoration: 'underline',
  cursor: 'pointer',
  color: 'primary.main',
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  display: 'inline',
  '&:hover': { color: 'primary.dark' },
};

export function McpLogInLink({ values, onSuccess, sx, title, projectId }: McpLogInLinkProps): ReactNode {
  const { isLoggedIn, isRunning, onLogin, stopPropagation, modalProps } = useMcpLogin({ values, onSuccess, projectId });

  if (isLoggedIn) return null;

  const label = title ?? t('mcps.logInLink.label', 'Log in.');

  return (
    <>
      {/* A real <button> (R-C1): `linkSx` already resets border/background/padding/font to
          nothing, so it reads as inline text while keeping native keyboard/focus semantics —
          no role/tabIndex/onKeyDown polyfill needed (unlike the baseline's bare clickable
          Typography, which had neither). */}
      <Typography
        component="button"
        type="button"
        variant="bodySmall"
        onClick={onLogin}
        onMouseDown={stopPropagation}
        onMouseEnter={stopPropagation}
        onMouseLeave={stopPropagation}
        disabled={isRunning}
        sx={combineSx(linkSx, sx)}
      >
        {isRunning ? t('mcps.logInLink.loggingIn', 'Logging in...') : label}
      </Typography>
      {modalProps.open && <McpAuthModal {...modalProps} />}
    </>
  );
}
