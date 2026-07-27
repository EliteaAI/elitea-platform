import type { ReactNode } from 'react';
import { useEffect } from 'react';

import Box from '@mui/material/Box';

import { getConfig } from '@/shared/config';
import {
  Sidebar,
  usePermissionSet,
  useProjectOptions,
  useSidebarCollapsedStore,
  SIDE_BAR_WIDTH_PX,
  COLLAPSED_SIDE_BAR_WIDTH_PX,
} from '@/widgets/sidebar';

import { useSelectedProject } from '../model/useSelectedProject.hooks';
import { NavBlockerDialog } from './NavBlockerDialog';
import { PageTitleSetter } from './PageTitleSetter';

export interface AppShellProps {
  children: ReactNode;
}

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
 * Dropped from the old app's `AppLayoutInner`, documented (not silently
 * dropped):
 *  - `InteractiveTourProvider`/`InteractiveTourRoot`/`useInteractiveTourController`
 *    (`features/interactive-tours`) — not ported by any landed Wave-1/2
 *    unit; every `data-tour="..."` attribute this widget's children might
 *    reference is simply inert until that feature lands.
 *  - `SupportAssistantWidget` (`widgets/support-assistant`) — outside this
 *    unit's owned paths (not `src/widgets/{sidebar,create-button,
 *    app-shell}/`) and not in this unit's `sourceFiles` slice.
 *  - `MaintenanceBanner` (`features/maintenance/**`, listed in this unit's
 *    `sourceFiles`) — needs `VITE_MAINTENANCE_MESSAGE/START/END/BANNER`,
 *    which are outside `shared/config`'s CLOSED `ConfigSchema` (F3, six
 *    keys, explicitly documented as closed) and this unit cannot extend
 *    that schema (outside its ownership fence). No banner renders; adding
 *    one without a real config source would be exactly the "no placeholder
 *    code" rule's target.
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
  const { projects } = useProjectOptions(publicProjectId);
  const permissions = usePermissionSet(project?.id);
  const collapsed = useSidebarCollapsedStore((state) => state.collapsed);

  // Old app: `SidebarProjectSelect`/`ProjectSelect` default to the caller's
  // private project when nothing is selected yet. This app has no
  // "personal project" signal (see `widgets/sidebar/index.ts`'s header) —
  // the closest faithful default is the FIRST option in the already-ordered
  // (public-pinned-first, then alphabetical) list `useProjectOptions`
  // returns.
  useEffect(() => {
    if (project !== null) return;
    const first = projects[0];
    if (first) selectProject(String(first.id), first.name);
  }, [project, projects, selectProject]);

  const sidebarWidth = collapsed ? COLLAPSED_SIDE_BAR_WIDTH_PX : SIDE_BAR_WIDTH_PX;

  return (
    <Box sx={{ display: 'flex' }}>
      <Sidebar
        permissions={permissions}
        projects={projects}
        selectedProjectId={project?.id}
        onSelectProject={selectProject}
      />
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
        {children}
        <NavBlockerDialog />
      </Box>
    </Box>
  );
}
