/** ROUTE-016 `/skills/:tab/:skillId` -> `EditSkill` (SkillsGuard cascades from `$tab.tsx`). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/skills/$tab/$skillId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="skills.tab.skillId" fallback="Edit Skill" />
      <Outlet />
    </>
  ),
});
