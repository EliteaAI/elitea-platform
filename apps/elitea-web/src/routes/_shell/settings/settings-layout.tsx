import { Outlet } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { SETTINGS_LAYOUT } from '@/shared/ui/settings/settings.constants';
import { type SettingsSection, SettingsDrawer } from '@/shared/ui/settings/SettingsDrawer';
import { SettingsRedirect } from '@/shared/ui/settings/SettingsRedirect';

/**
 * Top-level Settings page layout. Replaces the placeholder `SettingsLayout`
 * in `route.tsx`. Renders:
 *
 * 1. A left sidebar (`SettingsDrawer`) with project and personal section tabs.
 * 2. An `<Outlet />` for tab-specific content.
 * 3. Inline `SettingsRedirect` for legacy/invalid tab handling.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/settings/index.jsx`.
 */
export function SettingsLayout() {
  const sections: SettingsSection[] = [
    {
      section: 'PROJECT',
      tabs: [
        {
          id: 'model-configuration',
          label: 'AI Configuration',
        },
        {
          id: 'prompts',
          label: 'Service Prompts',
        },
        {
          id: 'environment',
          label: 'Environment',
        },
        {
          id: 'project-params',
          label: 'Project Params',
        },
        {
          id: 'secrets',
          label: 'Secrets',
        },
        {
          id: 'users',
          label: 'Users',
        },
        {
          id: 'analytics',
          label: 'Analytics',
        },
      ],
    },
    {
      section: 'PERSONAL',
      tabs: [
        {
          id: 'personalization',
          label: 'Personalization',
        },
        {
          id: 'tokens',
          label: 'Personal Tokens',
        },
        {
          id: 'notifications',
          label: 'Notifications',
        },
        {
          id: 'logout',
          label: 'Log out',
        },
      ],
    },
  ];

  const handleItemClick = (tabId: string) => {
    // For now, navigate to the tab route. Later: add permissions, public project,
    // and analytics checks here, same as the old app's `useMemo` filter.
    window.history.replaceState(
      null,
      '',
      `/settings/${tabId}`,
    );
  };

  return (
    <Box sx={styles.container}>
      <Box sx={styles.drawer}>
        <SettingsDrawer
          sections={sections}
          onItemClick={handleItemClick}
        />
      </Box>
      <Box
        component="main"
        sx={styles.mainContent}
      >
        <Outlet />
      </Box>
      <SettingsRedirect />
    </Box>
  );
}

/** @type {MuiSx} */
const styles: Record<string, SxProps<Theme>> = {
  container: {
    display: 'flex',
    height: '100%',
  },
  drawer: ({ palette }) => ({
    width: SETTINGS_LAYOUT.DRAWER_WIDTH,
    flexShrink: 0,
    height: '100%',
    backgroundColor: palette.background.secondary,
    borderRight: `0.0625rem solid ${palette.border.table}`,
    boxSizing: 'border-box',
  }),
  mainContent: ({ palette }) => ({
    flexGrow: 1,
    height: '100%',
    background: palette.background.settingsPage,
    maxWidth: `calc(100% - ${SETTINGS_LAYOUT.DRAWER_WIDTH})`,
    overflow: 'auto',
  }),
};
