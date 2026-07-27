/** ROUTE-014 `/skills/create` -> `CreateSkill`, wrapped in `SkillsGuard` (PERM-058). */
import { createFileRoute } from '@tanstack/react-router';

import { skillsGuardBeforeLoad } from '../../-guards/skillsGuard';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/skills/create')({
  beforeLoad: skillsGuardBeforeLoad,
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="skills.create" fallback="Create Skill" />,
});
