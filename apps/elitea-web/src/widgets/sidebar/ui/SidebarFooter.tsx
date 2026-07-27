import type { ReactNode } from 'react';

import { Link, useRouterState } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { GearIcon } from '@/shared/ui/icons/gear-icon';
import { ResourcesIcon } from '@/shared/ui/icons/resources-icon';
import { t } from '@/shared/i18n';

export interface SidebarFooterProps {
  collapsed: boolean;
}

/**
 * Ported from `SidebarBody.jsx`'s bottom section
 * (`Buttons.SettingsButton`/`Buttons.ResourcesButton`, full-width variant).
 * `Buttons.AgentHubButton` (the "Agent HUB" pill) is dropped: it links to
 * `/agents-hub`, which is `SIMPLE_CREATE_ROUTE`-equivalent territory owned
 * by unit A13 (`src/pages/agents-hub/**`) — a plain nav link with no data
 * dependency this widget lacks, but adding a 3rd, cosmetically-distinct
 * pill button without the page it targets landing yet risks visual drift
 * from whatever A13 ships; left for that unit or a follow-up to wire once
 * `/agents-hub` has real content to link to.
 */
export function SidebarFooter({ collapsed }: SidebarFooterProps): ReactNode {
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const onSettings = pathname.startsWith('/settings');
  const onHelp = pathname === '/help-center';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', paddingInline: '1rem', gap: '0.5rem', paddingBottom: '0.5rem' }}>
      <FooterLink
        to="/settings/model-configuration"
        icon={<GearIcon style={{ width: '1rem', height: '1rem' }} />}
        label={t('widgets.sidebar.settings', 'Settings')}
        collapsed={collapsed}
        active={onSettings}
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
