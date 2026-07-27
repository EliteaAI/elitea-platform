/**
 * Port of apps/elitea-ui/src/[fsd]/features/mcp/ui/McpLogoutButton.jsx
 * (unit A5, manifest COPY-143).
 */
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { LogoutIcon } from '@/shared/ui/icons/logout-icon';

import { logout } from '../lib/storage';

import { McpLogoutModal } from './McpLogoutModal';

export interface McpLogoutButtonProps {
  serverUrl?: string | undefined;
  toolkitType?: string | undefined;
  onSuccess?: (() => void) | undefined;
  sx?: SxProps<Theme> | undefined;
}

export function McpLogoutButton({ serverUrl, toolkitType, onSuccess, sx }: McpLogoutButtonProps): ReactNode {
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const onConfirmLogout = useCallback(() => {
    if (serverUrl) logout(serverUrl, toolkitType);
    setShowLogoutModal(false);
    onSuccess?.();
  }, [serverUrl, toolkitType, onSuccess]);

  const onLogout = useCallback((event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    setShowLogoutModal(true);
  }, []);

  const onCloseLogout = useCallback(() => setShowLogoutModal(false), []);

  const stopPropagation = useCallback((event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  }, []);

  return (
    <>
      <Tooltip
        title={t('mcps.logoutButton.tooltip', 'Log out')}
        placement="top"
      >
        <IconButton
          id="LogoutButton"
          onClick={onLogout}
          onMouseDown={stopPropagation}
          onMouseEnter={stopPropagation}
          onMouseLeave={stopPropagation}
          color="tertiary"
          sx={sx}
          aria-label={t('mcps.logoutButton.tooltip', 'Log out')}
        >
          <LogoutIcon
            width={16}
            height={16}
          />
        </IconButton>
      </Tooltip>
      <McpLogoutModal
        serverUrl={serverUrl}
        toolkitType={toolkitType}
        open={showLogoutModal}
        onClose={onCloseLogout}
        onConfirm={onConfirmLogout}
      />
    </>
  );
}
