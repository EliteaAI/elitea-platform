import type { ReactNode } from 'react';
import { useEffect } from 'react';

import Box from '@mui/material/Box';
import { useRouterState } from '@tanstack/react-router';

import { getConfig } from '@/shared/config';
import { usePlatformAnnouncements } from '@/shared/lib/hooks/usePlatformAnnouncements';
import type { SocialAuthorProfile } from '@/shared/api/generated/model';
import { useGetCurrentAuthor } from '@/shared/api/generated/social/social';
import {
  Sidebar,
  usePermissionSet,
  useProjectOptions,
  useSidebarCollapsedStore,
  SIDE_BAR_WIDTH_PX,
  COLLAPSED_SIDE_BAR_WIDTH_PX,
} from '@/widgets/sidebar';

import { useSelectedProject } from '../model/useSelectedProject.hooks';
import { MaintenanceSplash } from './MaintenanceSplash';
import { NavBlockerDialog } from './NavBlockerDialog';
import { PlatformBanner } from './PlatformBanner';
import { PageTitleSetter } from './PageTitleSetter';

export interface AppShellProps {
  children: ReactNode;
}

/**
 * `useGetCurrentAuthor()`'s `.data` is the same enveloped `{data, status,
 * headers}` shape `pages/chat/useChatPageData.ts`'s `currentAuthorOf` reads
 * through (`getCurrentAuthorResponse200`, `shared/api/generated/social/
 * social.ts`) — `eliteaFetch` throws on non-2xx (§3.6 unwrap contract), so
 * the 401 branch is declared but unreachable at this read site, same
 * established precedent.
 */
function personalProjectIdOf(data: unknown): string | undefined {
  return (data as { readonly data?: SocialAuthorProfile } | undefined)?.data?.personal_project_id;
}

/** Old app: `RouteDefinitions.Onboarding` (`routes.js`), matched by exact pathname equality (`useIsOnboarding.hooks.js`). */
const ONBOARDING_PATHNAME = '/onboarding';

/**
 * Display name for the caller's personal project when the project list
 * genuinely has no entry for `personal_project_id` — the old app's own
 * literal (`settings.js`'s `authorDetails.matchFulfilled` extraReducer
 * writes `{id: payload.personal_project_id, name: 'Private'}`).
 *
 * This is a LAST RESORT, not the normal path (issue #161). When the list
 * does contain the personal project — the ordinary case, since
 * `useProjectOptions` returns every project the caller can see — its real
 * `name` is used instead, so this widget and `widgets/sidebar`'s
 * `ProjectSwitcher` (which has always written `project.name`) resolve the
 * SAME name for the same id. They both persist to `el.project.name`, and
 * before this constant existed whichever ran first decided what every
 * reader of that key showed — the Analytics header's "Project: {name}",
 * the switcher's own accessible name and collapsed tooltip. The id was
 * identical on both paths, so nothing ever read the wrong project's data;
 * the divergence was the LABEL only.
 */
const PERSONAL_PROJECT_FALLBACK_NAME = 'Private';

/**
 * The app shell every page composes inside (task brief: "every other page
 * in the whole app composes inside app-shell's layout"). Ported from
 * `[fsd]/app/layout/{AppLayout,MainPanel,MainSidebar}.jsx`.
 *
 * `<AppShell>{pageContent}</AppShell>` — a page/route component wraps its
 * own content in this, rather than the router's `_shell` layout route doing
 * it centrally. This is deliberate, not an oversight: `widgets/**` sits
 * BELOW `pages`/`src/routes/**` in the layer order (spec §3.2), so a widget
 * cannot reach up and wrap the router's Outlet itself — pages reach DOWN
 * into widgets, never the reverse. `src/routes/_shell/route.tsx`'s own doc
 * comment names exactly this as "Wave-2/unit-S1 territory" (task item 6),
 * i.e. this component is that promised piece; the next unit to author a
 * `pages/**` route target wraps its content in `<AppShell>`.
 *
 * Onboarding-page chrome: ported from `MainSidebar.jsx`/`MainPanel.jsx` —
 * the sidebar is hidden entirely (not just visually collapsed) on the
 * `/onboarding` route for a user with no personal project yet, and the
 * main content's left offset collapses to `0` on that same route
 * regardless of the personal-project signal (an old-app asymmetry
 * reproduced faithfully here, not smoothed over).
 *
 * Dropped from the old app's `AppLayoutInner`, documented (not silently
 * dropped):
 *  - `InteractiveTourProvider`/`InteractiveTourRoot`/`useInteractiveTourController`
 *    (`features/interactive-tours`) — STALE CLAIM, corrected: this feature
 *    is now a complete, landed slice (`InteractiveTourRoot.tsx`,
 *    `useInteractiveTourController.hooks.ts`, `useTourFromUrl.hooks.ts`,
 *    the tour cards, ~20 per-page tour-constant files) whose own barrel
 *    (`features/interactive-tours/index.ts`) names "app-composition
 *    layers" as an intended consumer. Composing it into this widget
 *    (provider + root + `useTourFromUrl()`, mirroring `AppLayout.jsx`) is
 *    real feature-wiring work — a follow-up unit's job, not folded into
 *    this fix — but the blocking reason above is gone: every
 *    `data-tour="..."` attribute this widget's children reference has a
 *    real, already-built consumer waiting to be wired up, not an
 *    unbuilt one.
 *  - `SupportAssistantWidget` (`widgets/support-assistant`) — outside this
 *    unit's owned paths (not `src/widgets/{sidebar,create-button,
 *    app-shell}/`) and not in this unit's `sourceFiles` slice.
 *  - `MaintenanceBanner` (`features/maintenance/**`, listed in this unit's
 *    `sourceFiles`) — STALE CLAIM, corrected: this was dropped because the
 *    banner's only config source was `VITE_MAINTENANCE_MESSAGE/START/END/
 *    BANNER`, build-time environment variables outside `shared/config`'s
 *    CLOSED `ConfigSchema`, and "adding one without a real config source
 *    would be exactly the 'no placeholder code' rule's target". The reason
 *    was right and the config source now exists: admin › Configuration ›
 *    Banner writes `centry.platform_config` and `platform_settings`
 *    publishes it. Rendered below as `<PlatformBanner>`, alongside the
 *    maintenance splash the same admin page now enables.
 *  - The `ImportWizardModal` trigger/UI (`[fsd]/entities/import-wizard/**`,
 *    listed in `sourceFiles`) — its parsing pipeline
 *    (`parseMdFrontmatter`/`mdToApplicationJson`) transitively imports
 *    `features/pipelines/flow-editor/lib/helpers` (layout/YAML parsing for
 *    pipeline nodes), a feature slice no landed Wave-2 unit has built, and
 *    depends on `jszip`/`uuid`, neither installed in `package.json`
 *    (verified: `grep '"jszip"\|"uuid"' package.json` → 0 hits; adding a
 *    dependency is `F1`'s file, outside this unit's fence). Not built.
 */
export function AppShell({ children }: AppShellProps): ReactNode {
  const configResult = getConfig();
  const publicProjectId = configResult.status === 'ok' ? configResult.config.vite_public_project_id : '';

  const { project, selectProject } = useSelectedProject();
  const { projects, isLoading: projectsLoading } = useProjectOptions(publicProjectId);
  const permissions = usePermissionSet(project?.id);
  const collapsed = useSidebarCollapsedStore((state) => state.collapsed);
  const authorQuery = useGetCurrentAuthor();
  const personalProjectId = personalProjectIdOf(authorQuery.data);
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const { banner, maintenance } = usePlatformAnnouncements();
  const isOnboardingPage = pathname === ONBOARDING_PATHNAME;
  const hideSidebar = isOnboardingPage && !personalProjectId;

  // Old app: `settings.js`'s `authorDetails.matchFulfilled` extraReducer
  // defaults the selected project to the CALLER'S OWN personal/private
  // project (`{id: payload.personal_project_id, name: 'Private'}`) once
  // `GET /social/author` resolves, whenever nothing is selected yet — never
  // to the first entry of the public/shared project list. `personal_
  // project_id` IS a real, already-used signal in this app: `pages/chat/
  // useChatPageData.ts` reads the exact same `useGetCurrentAuthor()` query
  // for the exact same fallback. Until that query resolves, nothing is
  // selected (matching the old app's own brief pre-load window).
  //
  // The NAME, unlike the id, is resolved from the project list rather than
  // written as a literal (issue #161) — see PERSONAL_PROJECT_FALLBACK_NAME.
  // The list is also what gates this effect: writing before it settles
  // would persist the fallback name for a project whose real name was
  // merely one request away, and this effect never revisits a selection it
  // has already made (`project !== null` returns above). `isLoading` is
  // false — not stuck true — when the underlying query is disabled, so an
  // unusable `publicProjectId` degrades to the fallback rather than
  // deadlocking the auto-selection.
  useEffect(() => {
    if (project !== null) return;
    if (!personalProjectId) return;
    if (projectsLoading) return;
    const personalProject = projects.find((candidate) => String(candidate.id) === personalProjectId);
    selectProject(personalProjectId, personalProject?.name ?? PERSONAL_PROJECT_FALLBACK_NAME);
  }, [project, personalProjectId, projects, projectsLoading, selectProject]);

  const sidebarWidth = isOnboardingPage ? 0 : collapsed ? COLLAPSED_SIDE_BAR_WIDTH_PX : SIDE_BAR_WIDTH_PX;

  // A maintenance window replaces the whole shell — sidebar included — for
  // everyone the API is refusing. Rendering the product around the splash would
  // leave every control looking usable while every request behind it answers
  // 503, which is the confusion this screen exists to remove.
  //
  // `bypass` is the SERVER's answer for this caller, not a permission check
  // repeated here: an administrator keeps the product, because they are the
  // person who has to end the window. See `usePlatformAnnouncements`.
  if (maintenance.enabled && !maintenance.bypass) {
    return <MaintenanceSplash maintenance={maintenance} />;
  }

  return (
    <Box sx={{ display: 'flex' }}>
      {!hideSidebar && (
        <Sidebar
          permissions={permissions}
          projects={projects}
          selectedProjectId={project?.id}
          onSelectProject={selectProject}
        />
      )}
      <Box
        component="main"
        sx={{
          display: 'block',
          flexGrow: 1,
          width: `calc(100% - ${sidebarWidth}px)`,
          maxWidth: `calc(100% - ${sidebarWidth}px)`,
          height: '100vh',
          boxSizing: 'border-box',
          position: 'relative',
        }}
      >
        <PageTitleSetter projectName={project?.name} />
        {/* Above the page content and inside `main`, so it scrolls with the
            document rather than floating over it. The legacy banner was
            absolutely positioned at `zIndex: 2400`, which put it on top of
            every dialog in the app. */}
        <PlatformBanner banner={banner} />
        {children}
        <NavBlockerDialog />
      </Box>
    </Box>
  );
}
