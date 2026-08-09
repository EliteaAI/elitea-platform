import { Outlet } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { performLogout } from '@/shared/api/auth';
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
/** The PERSONAL section's action item that is not a route (see `handleItemClick`). */
const LOGOUT_TAB_ID = 'logout';

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
          id: LOGOUT_TAB_ID,
          label: 'Log out',
        },
      ],
    },
  ];

  const handleItemClick = (tabId: string) => {
    // "Log out" is not a tab: there is no `routes/_shell/settings/logout.tsx`,
    // so treating it like one only pushed a URL with no route behind it and
    // `SettingsRedirect` bounced the user straight back into the app with
    // every `el.*` key intact (issue #136 A). `performLogout()` is the real
    // implementation — the `el.` namespace sweep in both storage areas plus
    // the `/forward-auth/logout` handoff that clears the server session
    // cookie — and this is its call site.
    if (tabId === LOGOUT_TAB_ID) {
      performLogout();
      return;
    }
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
    borderRight: `0.0625rem solid ${palette.border?.table ?? 'transparent'}`,
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
