/**
 * Port of apps/elitea-ui/src/[fsd]/features/mcp/ui/McpLogInButton.jsx (unit
 * A5, manifest COPY-141).
 */
import type { ReactNode } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { combineSx } from '@/shared/ui/lib/combineSx';

import type { McpAuthModalValues } from '../model/useMcpAuthModal';
import type { McpLoginAuthConfig } from '../model/useMcpLogin';
import { useMcpLogin } from '../model/useMcpLogin';

import { McpAuthModal } from './McpAuthModal';

export interface McpLogInButtonProps {
  values: McpAuthModalValues;
  onSuccess?: (() => void) | undefined;
  sx?: SxProps<Theme> | undefined;
  title?: string | undefined;
  authConfig?: McpLoginAuthConfig | undefined;
  projectId?: string | number | undefined;
}

export function McpLogInButton({ values, onSuccess, sx, title, authConfig, projectId }: McpLogInButtonProps): ReactNode {
  const { isLoggedIn, isRunning, onLogin, modalProps } = useMcpLogin({ values, onSuccess, authConfig, projectId });

  if (isLoggedIn) return null;

  const label = title ?? t('mcps.logInButton.label', 'Log in');

  return (
    <>
      <BaseBtn
        variant="elitea"
        color="tertiary"
        onClick={onLogin}
        disabled={isRunning}
        sx={combineSx({ color: 'primary.main', '&:hover': { color: 'primary.dark' } }, sx)}
      >
        {isRunning ? t('mcps.logInButton.loggingIn', 'Logging in...') : label}
      </BaseBtn>
      {modalProps.open && <McpAuthModal {...modalProps} />}
    </>
  );
}
