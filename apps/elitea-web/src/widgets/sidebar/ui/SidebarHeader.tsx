import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';

import { LogoIcon } from '@/shared/ui/icons/logo-icon';
import { t } from '@/shared/i18n';

import { SidebarConnectionDot } from './SidebarConnectionDot';

export interface SidebarHeaderProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Ported from `SidebarBody.jsx`'s sticky header block (the home/toggle
 * button + socket dot, SHELL-012). Uses the ported `LogoIcon` (full
 * wordmark, `apps/elitea-ui/src/assets/logo.svg`) rather than the old app's
 * separate `EliteAIcon` mark (`components/Icons/EliteAIcon.jsx`, a
 * hand-rolled inline `<svg>` never routed through `shared/assets/svg/**`
 * and therefore not among S2's 116 ported icons) — closest available
 * asset, documented substitution, not a fabricated one.
 *
 * `SidebarConnectionDot` self-degrades to nothing when no
 * `SocketClientContext.Provider` is mounted (see its own header) — always
 * rendered here, never conditionally, so it activates automatically once
 * `app/` wires the provider.
 */
export function SidebarHeader({ collapsed, onToggleCollapsed }: SidebarHeaderProps): ReactNode {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: '0 1rem',
        minHeight: '3.5rem',
      }}
    >
      <IconButton
        data-testid="sidebar-toggle"
        size="large"
        color="inherit"
        aria-label={t('widgets.sidebar.toggle', 'Toggle sidebar')}
        onClick={onToggleCollapsed}
        sx={{ position: 'relative', width: '2.75rem', height: '2.75rem' }}
      >
        <LogoIcon style={{ width: '1.75rem', height: '1.75rem' }} />
        <SidebarConnectionDot />
      </IconButton>
    </Box>
  );
}
