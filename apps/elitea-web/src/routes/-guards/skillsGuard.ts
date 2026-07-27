/**
 * SkillsGuard (spec §9.3 R1; PERM-058; faithful port of
 * `apps/elitea-ui/src/[fsd]/app/routes/SkillsGuard.jsx:9-22`).
 *
 * Old behaviour: `if (projectId == PUBLIC_PROJECT_ID) return <Navigate to="/chat" replace/>;
 * return children;` — Skills is hidden entirely in the Public project
 * (spec §8.6 skills row).
 *
 * Ported as a `beforeLoad` so the redirect happens before the route mounts
 * (TanStack Router `redirect()`), matching the old app's pre-render
 * `<Navigate>` semantics rather than a post-render flash.
 */
import { redirect } from '@tanstack/react-router';

import type { RouterContext } from '@/app/router-context';

import { isPublicProject } from './publicProject';

export function skillsGuardBeforeLoad({ context }: { context: RouterContext }): void {
  const projectId = context.auth.getSelectedProjectId();
  if (isPublicProject(projectId)) {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
    throw redirect({ to: '/chat' });
  }
}
