import type { ReactNode } from 'react';

import { Link } from '@tanstack/react-router';

import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import type { Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

export interface SidebarNavItemProps {
  label: string;
  icon: ReactNode;
  to: string;
  selected: boolean;
  showLabel: boolean;
}

/**
 * Ported from `[fsd]/widgets/sidebar-root/ui/SidebarMenuItem.jsx`, reduced:
 * the old app's "personal-space disabled" tooltip variant
 * (`TooltipForDisablePersonalSpace`/`useDisablePersonalSpace`) reads Redux
 * `state.user.personal_project_id`, which has no source in this app yet
 * (§ "current user identity" gap, `../index.ts`) — every item therefore
 * always renders through the plain collapsed-label tooltip path, never
 * disabled for that reason.
 *
 * A real `<Link>` (R-C1: a real interactive element), not a `Box` +
 * `onClick`.
 */
export function SidebarNavItem({ label, icon, to, selected, showLabel }: SidebarNavItemProps): ReactNode {
  return (
    <Tooltip
      title={showLabel ? '' : label}
      placement="right"
      enterDelay={500}
      enterNextDelay={500}
    >
      <ListItemButton
        component={Link}
        to={to}
        selected={selected}
        sx={(theme: Theme) => ({
          padding: '0.5rem',
          borderRadius: theme.vars.shape.radiusMd,
          height: '2rem',
          boxSizing: 'border-box',
          justifyContent: showLabel ? undefined : 'center',
          '&:hover': { background: theme.vars.palette.background.button.drawerMenu.hover },
          '&.Mui-selected': { background: theme.vars.palette.background.button.drawerMenu.selected },
          '&.Mui-selected:hover': { background: theme.vars.palette.background.button.drawerMenu.hover },
        })}
      >
        <ListItemIcon
          sx={{
            marginRight: showLabel ? '0.5rem' : 0,
            minWidth: '1rem',
            width: '1rem',
            height: '1rem',
          }}
        >
          {icon}
        </ListItemIcon>
        {showLabel && <Typography variant="labelSmall">{label}</Typography>}
      </ListItemButton>
    </Tooltip>
  );
}
