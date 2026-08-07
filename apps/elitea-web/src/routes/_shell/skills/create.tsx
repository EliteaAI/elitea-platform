/** ROUTE-014 `/skills/create` -> `CreateSkill`, wrapped in `SkillsGuard` (PERM-058). */
import { createFileRoute } from '@tanstack/react-router';

import { CreateSkill } from '@/pages/skills/CreateSkill';

import { skillsGuardBeforeLoad } from '../../-guards/skillsGuard';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/skills/create')({
  beforeLoad: skillsGuardBeforeLoad,
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateSkillRoute,
});

function CreateSkillRoute() {
  return (
    <CreateSkill />
  );
}
