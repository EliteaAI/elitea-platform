import { useCallback, useEffect, useMemo } from 'react';
import type { SyntheticEvent } from 'react';

import Box from '@mui/material/Box';

import { useNavigate, useParams, useSearch } from '@tanstack/react-router';

import {
  ApplicationCatalog,
  appsTabByIndex,
  appsTabIndex,
  isApplicationsTab,
  normalizeAppsTab,
  searchForAppsTab,
  useHasApplications,
} from '@/features/apps';
import { t } from '@/shared/i18n';
import { BaseTab } from '@/shared/ui/BaseTab';
import { BaseTabs } from '@/shared/ui/BaseTabs';
import { AppCatalogIcon } from '@/shared/ui/icons/app-catalog-icon';
import { ApplicationsIcon } from '@/shared/ui/icons/applications-icon';

const pageSx = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column' as const,
};

const tabBarSx = {
  flexShrink: 0,
  borderBottom: 1,
  borderColor: 'divider',
  padding: '0 1.5rem',
};

const tabPanelSx = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto' as const,
};

interface AppsRouteParams {
  readonly tab?: string;
}

/**
 * Matches PARAM-022/023's real `view` schema (`src/routes/-search/params.ts`,
 * `z.enum(['grid', 'list'])` — not imported from there directly: that file
 * lives in `src/routes/`, above this layer per R-L1). `useNavigate()`'s `to:
 * '/apps/$tab'` call below is typed against the REAL, registered
 * `/apps/$tab` route (via `src/app/router.tsx`'s `Register` module
 * augmentation, part of this same TS program), which expects exactly this
 * literal union for its search `view` field — a bare `string` does not
 * satisfy it.
 */
interface AppsRouteSearch {
  readonly view?: 'grid' | 'list';
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/pages/apps/Apps.jsx` — covers
 * ROUTE-036 (`/apps`) and ROUTE-039 (`/apps/:tab`), both of which render
 * this same component (`ProtectedRoutes.jsx:228,231`; NOT an index
 * redirect, unlike most other domains' `:tab` pages).
 *
 * The baseline's `useToolkitsListQuery`/imperative-`navigate` redirect
 * logic and its `getSearchForAppsTab` string manipulation both move into
 * `features/apps` (a hook and pure functions respectively) per spec §3.2 —
 * this component only reads router state and renders based on values
 * those already computed for it, no fetching/business logic of its own.
 *
 * **Composition gap, not a placeholder:** the baseline's "Applications" tab
 * renders `<ToolkitsList isApplication cardContentType={ContentType.AppAll}
 * disableEmptyRedirect />` (`features/toolkits/ui/list/ToolkitsList`, unit
 * A4's ownership — `src/features/toolkits/**` has not landed as of this
 * unit). That tab's content area is intentionally left EMPTY below rather
 * than faked; wiring `<ToolkitsList .../>` in is a one-line change once A4
 * ships (see the inline comment at the render site). The "App Catalog" tab
 * (`ApplicationCatalog`, this same domain, fully self-contained) is wired
 * completely.
 */
export function Apps() {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as AppsRouteParams;
  const search = useSearch({ strict: false }) as AppsRouteSearch;
  const { hasApplications } = useHasApplications();

  const normalizedTab = normalizeAppsTab(params.tab, hasApplications);
  const normalizedSearch = useMemo(
    () => searchForAppsTab(normalizedTab, search),
    [normalizedTab, search],
  );

  // `Apps.jsx:68-75` parity: redirect to the normalized `/apps/:tab[?view]`
  // URL when the raw param/search do not already match it (legacy alias,
  // bare `/apps`, or an unrecognised `:tab`) — `replace: true`, no history
  // entry, same as the baseline's `navigate(..., { replace: true })`.
  useEffect(() => {
    if (normalizedTab === params.tab && normalizedSearch === search) return;
    void navigate({
      to: '/apps/$tab',
      params: { tab: normalizedTab },
      search: normalizedSearch,
      replace: true,
    });
  }, [navigate, normalizedSearch, normalizedTab, params.tab, search]);

  const selectedIndex = appsTabIndex(normalizedTab);
  const isConfiguredTab = isApplicationsTab(normalizedTab);

  const handleChangeTab = useCallback(
    (_event: SyntheticEvent, nextIndex: number) => {
      const nextTab = appsTabByIndex(nextIndex);
      const nextSearch = searchForAppsTab(nextTab, search);
      void navigate({ to: '/apps/$tab', params: { tab: nextTab }, search: nextSearch });
    },
    [navigate, search],
  );

  const handleConfigureAppType = useCallback(
    (appType: string) => {
      void navigate({ to: '/apps/create/$appType', params: { appType } });
    },
    [navigate],
  );

  return (
    <Box sx={pageSx}>
      <Box sx={tabBarSx}>
        <BaseTabs
          value={selectedIndex}
          onChange={handleChangeTab}
          aria-label={t('apps.tabs.ariaLabel', 'Apps')}
        >
          <BaseTab
            label={t('apps.tabs.applications', 'Applications')}
            icon={<ApplicationsIcon />}
          />
          <BaseTab
            label={t('apps.tabs.catalog', 'App Catalog')}
            icon={<AppCatalogIcon />}
          />
        </BaseTabs>
      </Box>

      <Box
        sx={tabPanelSx}
        role="tabpanel"
      >
        {isConfiguredTab ? (
          // Composition gap: `features/toolkits`' `ToolkitsList` (unit A4)
          // has not landed — see this file's own doc comment. Once it
          // exists: `<ToolkitsList isApplication cardContentType={ContentType.AppAll} disableEmptyRedirect />`.
          <Box data-testid="apps-applications-tab-panel" />
        ) : (
          <ApplicationCatalog onConfigure={handleConfigureAppType} />
        )}
      </Box>
    </Box>
  );
}
