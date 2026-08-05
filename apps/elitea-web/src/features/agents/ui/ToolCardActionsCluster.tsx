import type { ReactNode } from 'react';

import DeleteIcon from '@mui/icons-material/Delete';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';
import { AttentionIcon } from '@/shared/ui/icons/attention-icon';
import { OfflineIcon } from '@/shared/ui/icons/offline-icon';
import { OnlineIcon } from '@/shared/ui/icons/online-icon';
import { OpenNewIcon } from '@/shared/ui/icons/open-new-icon';
import { RefreshIcon } from '@/shared/ui/icons/refresh-icon';

import { actionButtonSx, actionIconSx, attentionIconSx, buttonsContainerSx, statusIconBoxSx } from './ToolCard.styles';

/**
 * `ToolCard`'s trailing icon-button cluster (attention/refresh, open in new
 * tab, delete, MCP login/logout, SharePoint/OpenAPI delegated-auth slot,
 * MCP online/offline status), split out of `ToolCard.tsx` purely to keep
 * the `oxlint` `complexity` budget (≤12) — see `ToolCardBody.tsx`'s doc
 * comment for why (this region's inline `&&`/ternary chain was the single
 * largest contributor to `ToolCard`'s own complexity of 67).
 *
 * Props are grouped/precomputed by the caller (`ToolCard.tsx`) rather than
 * passed as the raw `tool`/`disabled`/`validation`/`delegatedAuth` shapes,
 * to stay within the §3.5 component-props budget (≤12) on THIS component
 * too — e.g. `openAction`/`removeAction` bundle the icon-button's
 * `onClick`/tooltip/disabled state the same way `ToolCardDelegatedAuthProps`
 * already bundles the MCP/SharePoint/OpenAPI slots one level up.
 */
export interface ToolCardActionButtonConfig {
  readonly onClick?: (() => void) | undefined;
  readonly tooltip: string;
  readonly disabled?: boolean | undefined;
}

export interface ToolCardActionsClusterProps {
  readonly iconColor: string;
  readonly showAttention: boolean;
  readonly onRevalidate?: (() => void) | undefined;
  readonly openAction: ToolCardActionButtonConfig;
  readonly removeAction: ToolCardActionButtonConfig;
  readonly isRemoving?: boolean | undefined;
  readonly isMcp: boolean;
  readonly mcpIsAuthorized: boolean;
  readonly mcpDisconnectedTip: string;
  readonly mcpLoginSlot?: ReactNode | undefined;
  readonly mcpLogoutSlot?: ReactNode | undefined;
  readonly extraAuthSlot?: ReactNode | undefined;
}

const iconColorSx = (iconColor: string): SxProps<Theme> => ({ color: iconColor });
const refreshButtonStyle = { width: '1rem', height: '1rem' };
const statusIconStyle = { width: '1rem', height: '1rem' };

export function ToolCardActionsCluster({ iconColor, showAttention, onRevalidate, openAction, removeAction, isRemoving, isMcp, mcpIsAuthorized, mcpDisconnectedTip, mcpLoginSlot, mcpLogoutSlot, extraAuthSlot }: ToolCardActionsClusterProps): ReactNode {
  return (
    <Box sx={buttonsContainerSx}>
      {showAttention && (
        <>
          <Box
            component={AttentionIcon}
            sx={attentionIconSx}
          />
          <Tooltip
            title={t('agents.toolCard.refreshTooltip', 'Refresh toolkit')}
            placement="top"
          >
            <IconButton
              className="agents-tool-card-action"
              data-testid="agent-toolkit-refresh-button"
              color="tertiary"
              aria-label={t('agents.toolCard.refreshAriaLabel', 'refresh toolkit')}
              onClick={onRevalidate}
              sx={actionButtonSx}
            >
              <RefreshIcon style={refreshButtonStyle} />
            </IconButton>
          </Tooltip>
        </>
      )}
      <Tooltip
        title={openAction.tooltip}
        placement="top"
      >
        <IconButton
          className="agents-tool-card-action"
          data-testid="agent-toolkit-open-button"
          color="tertiary"
          aria-label={t('agents.toolCard.openInNewTabAriaLabel', 'open in new tab')}
          onClick={openAction.onClick}
          disabled={openAction.disabled}
          sx={actionButtonSx}
        >
          <Box
            component={OpenNewIcon}
            sx={combineSx(actionIconSx, iconColorSx(iconColor))}
          />
        </IconButton>
      </Tooltip>
      <Tooltip
        title={removeAction.tooltip}
        placement="top"
      >
        <IconButton
          className="agents-tool-card-action"
          data-testid="agent-toolkit-delete-button"
          color="tertiary"
          aria-label={t('agents.toolCard.deleteAriaLabel', 'delete tool')}
          onClick={removeAction.onClick}
          disabled={removeAction.disabled}
          sx={actionButtonSx}
        >
          <DeleteIcon sx={combineSx(actionIconSx, iconColorSx(iconColor))} />
          {isRemoving && <CircularProgress size={20} />}
        </IconButton>
      </Tooltip>
      {isMcp && mcpLoginSlot}
      {isMcp && mcpIsAuthorized && mcpLogoutSlot}
      {extraAuthSlot}
      {isMcp && (
        <Tooltip
          title={mcpDisconnectedTip}
          placement="top"
        >
          <Box sx={statusIconBoxSx(mcpIsAuthorized)}>{mcpIsAuthorized ? <OnlineIcon style={statusIconStyle} /> : <OfflineIcon style={statusIconStyle} />}</Box>
        </Tooltip>
      )}
    </Box>
  );
}
