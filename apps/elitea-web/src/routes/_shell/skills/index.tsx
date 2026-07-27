/**
 * ROUTE-013 `/skills` -> index redirect to the first Skills tab
 * (`SkillsTabs = ['all']`, `common/constants.js:484`), wrapped in
 * `SkillsGuard` (PERM-058): hidden entirely in the Public project.
 * `beforeLoad` runs the guard BEFORE the redirect so a public-project user
 * lands on `/chat`, not `/skills/all`.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

import { skillsGuardBeforeLoad } from '../../-guards/skillsGuard';

export const Route = createFileRoute('/_shell/skills/')({
  beforeLoad: (ctx) => {
    skillsGuardBeforeLoad(ctx);
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
    throw redirect({ to: '/skills/$tab', params: { tab: 'all' } });
  },
});
