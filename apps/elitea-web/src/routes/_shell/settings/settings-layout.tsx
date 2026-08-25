import { Outlet, useNavigate } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { performLogout } from '@/shared/api/auth';
import { t } from '@/shared/i18n';
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
  const navigate = useNavigate();
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
        // Baseline order (`[fsd]/pages/settings/index.jsx:112-141`):
        // Profile, Preferences, AI Personality, Memory, Personal Tokens,
        // Notifications. Preferences/AI Personality/Memory had no counterpart
        // here at all — the pages existed in production and simply were not
        // ported. `Profile` is still absent; its identity rows (full name,
        // email, user id, last login) and the Log out button that lived with
        // them have no home yet, which is why Log out is a nav item below
        // rather than a control on a page.
        {
          id: 'preferences',
          label: 'Preferences',
        },
        {
          id: 'ai-personality',
          label: 'AI Personality',
        },
        {
          id: 'memory',
          label: 'Memory',
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
    // NAVIGATE THROUGH THE ROUTER, NOT window.history.
    //
    // This used to be `window.history.replaceState(null, '', `/settings/${tabId}`)`,
    // which broke three things at once:
    //
    //  1. It wrote a path with no base. The SPA is served under `/app/`, so
    //     clicking "Secrets" put `/settings/secrets` in the address bar.
    //     Reloading, bookmarking or sharing that URL reached nginx, which
    //     serves the shell only under /app/, and answered `404 page not
    //     found`. Verified against a live deployment: GET /settings/secrets
    //     is 404, GET /app/settings/secrets is 200.
    //  2. replaceState REPLACES the history entry, so Back could never return
    //     to the tab the user came from.
    //  3. It dropped the search parameters the route validates.
    //
    // `navigate` resolves the route's own path, keeps the base, pushes a real
    // entry, and carries the current search through.
    // Later: add permissions, public project, and analytics checks here, same
    // as the old app's `useMemo` filter.
    void navigate({ to: '/settings/$tab', params: { tab: tabId }, search: (previous) => previous });
  };

  return (
    <Box sx={styles.container}>
      <Box sx={styles.drawer}>
        <SettingsDrawer
          sections={sections}
          onItemClick={handleItemClick}
        />
      </Box>
      {/* A <section>, not a second <main>. `widgets/app-shell/ui/AppShell.tsx`
        * already wraps this whole route in the page's one <main> landmark.
        * So `component="main"` here nested a landmark inside itself, which is
        * invalid. It also left assistive technology with two "main" regions to
        * choose between. Verified on a live deployment:
        * document.querySelector('main main') was non-null on every shell
        * page. */}
      <Box
        component="section"
        aria-label={t('shared.ui.settings.drawer.title', 'Settings')}
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
