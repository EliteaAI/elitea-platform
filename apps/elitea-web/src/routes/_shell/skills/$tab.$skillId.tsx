/** ROUTE-016 `/skills/:tab/:skillId` -> `EditSkill` (SkillsGuard cascades from `$tab.tsx`). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { EditSkill } from '@/pages/skills/EditSkill';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/skills/$tab/$skillId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EditSkillRoute,
});

function EditSkillRoute() {
  return (
    <>
      <EditSkill />
      <Outlet />
    </>
  );
}
