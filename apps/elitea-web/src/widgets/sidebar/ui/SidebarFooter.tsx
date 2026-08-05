import type { ReactNode } from 'react';

import { Link, useRouterState } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { AgentHubIcon } from '@/shared/ui/icons/agent-hub-icon';
import { GearIcon } from '@/shared/ui/icons/gear-icon';
import { ResourcesIcon } from '@/shared/ui/icons/resources-icon';
import { t } from '@/shared/i18n';

export interface SidebarFooterProps {
  collapsed: boolean;
}

/**
 * Ported from `SidebarBody.jsx`'s bottom section
 * (`Buttons.SettingsButton`/`Buttons.ResourcesButton`, full-width variant,
 * plus `Buttons.AgentHubButton`).
 *
 * `Buttons.AgentHubButton` (the "Agent HUB" pill, `ui/button/
 * AgentHubButton.jsx`) is wired back in as `AgentHubLink` below. It was
 * previously dropped on the grounds that `/agents-hub` (owned by unit A13)
 * hadn't landed yet — that blocker is stale: `src/pages/agents-hub/
 * AgentHub.tsx` (225 lines, commit e836d63) and `src/routes/_shell/
 * agents-hub.tsx` both exist, so this ungated, always-visible pill has real
 * content to point at, same as every other footer link here.
 */
export function SidebarFooter({ collapsed }: SidebarFooterProps): ReactNode {
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const onSettings = pathname.startsWith('/settings');
  const onHelp = pathname === '/help-center';
  const onAgentHub = pathname === '/agents-hub';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', paddingInline: '1rem', gap: '0.5rem', paddingBottom: '0.5rem' }}>
      <FooterLink
        to="/settings/model-configuration"
        icon={<GearIcon style={{ width: '1rem', height: '1rem' }} />}
        label={t('widgets.sidebar.settings', 'Settings')}
        collapsed={collapsed}
        active={onSettings}
      />
      <AgentHubLink
        collapsed={collapsed}
        active={onAgentHub}
      />
      <FooterLink
        to="/help-center"
        icon={<ResourcesIcon style={{ width: '1.25rem', height: '1.25rem' }} />}
        label={t('widgets.sidebar.helpCenter', 'Help Center')}
        collapsed={collapsed}
        active={onHelp}
      />
    </Box>
  );
}

interface AgentHubLinkProps {
  collapsed: boolean;
  active: boolean;
}

/**
 * Ported from `ui/button/AgentHubButton.jsx` — an always-visible, ungated
 * pill (no `PERMISSION_GROUPS` entry in the old app either) navigating to
 * `/agents-hub`. Cosmetically distinct from the plain `FooterLink` rows
 * around it, matching the old app's own `background.button.agentHub.*`
 * token family (default/active/hover + inset box-shadow variants) and
 * `palette.primary.main` icon/text colour, rather than `FooterLink`'s
 * shared drawer-menu hover token — same distinction the old app drew
 * between this pill and `Buttons.SettingsButton`.
 */
function AgentHubLink({ collapsed, active }: AgentHubLinkProps): ReactNode {
  const label = t('widgets.sidebar.agentHub', 'Agent HUB');
  return (
    <Tooltip
      title={collapsed ? label : ''}
      placement="right"
      enterDelay={500}
      enterNextDelay={500}
    >
      <Box
        component={Link}
        to="/agents-hub"
        data-testid="sidebar-agent-hub-button"
        sx={(theme: Theme) => ({
          width: collapsed ? '2rem' : '100%',
          height: '2rem',
          padding: collapsed ? '0.5rem 0' : '0.5rem',
          borderRadius: theme.vars.shape.radiusMd,
          background: active
            ? theme.vars.palette.background.button.agentHub.active
            : theme.vars.palette.background.button.agentHub.default,
          boxShadow: active
            ? theme.vars.palette.background.button.agentHub.shadowActive
            : theme.vars.palette.background.button.agentHub.shadowDefault,
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-start',
          alignItems: 'center',
          gap: '0.5rem',
          boxSizing: 'border-box',
          color: theme.vars.palette.primary.main,
          textDecoration: 'none',
          '&:hover': {
            background: theme.vars.palette.background.button.agentHub.hover,
            boxShadow: theme.vars.palette.background.button.agentHub.shadowHover,
          },
        })}
      >
        <AgentHubIcon style={{ width: '1rem', height: '1rem' }} />
        {!collapsed && (
          <Typography
            variant="labelSmall"
            sx={{ color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {label}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
}

interface FooterLinkProps {
  to: string;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  active: boolean;
}

function FooterLink({ to, icon, label, collapsed, active }: FooterLinkProps): ReactNode {
  return (
    <Tooltip
      title={collapsed ? label : ''}
      placement="right"
      enterDelay={500}
      enterNextDelay={500}
    >
      <Box
        component={Link}
        to={to}
        sx={(theme: Theme) => ({
          width: collapsed ? '2rem' : '100%',
          height: '2rem',
          padding: collapsed ? '0.5rem 0' : '0.5rem',
          borderRadius: theme.vars.shape.radiusMd,
          background: active ? theme.vars.palette.background.button.drawerMenu.selected : 'transparent',
          '&:hover': { backgroundColor: theme.vars.palette.background.button.drawerMenu.hover },
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-start',
          alignItems: 'center',
          gap: '0.5rem',
          boxSizing: 'border-box',
          color: active ? theme.vars.palette.text.secondary : theme.vars.palette.text.metrics,
          textDecoration: 'none',
        })}
      >
        {icon}
        {!collapsed && <Typography variant="labelSmall">{label}</Typography>}
      </Box>
    </Tooltip>
  );
}
