import { isPublicProject } from '@/entities/project';
import { getConfig } from '@/shared/config';

/**
 * `projectId == PUBLIC_PROJECT_ID` (old app: `pages/Applications/
 * Applications.jsx:57`, `common/constants.js:61` — `PUBLIC_PROJECT_ID =
 * +VITE_PUBLIC_PROJECT_ID`), reproduced for `pages/agents/**` specifically.
 *
 * Deliberately NOT importing `src/routes/-guards/publicProject.ts`, which
 * carries the exact same two-line body: that module lives in `src/routes/`,
 * a layer `pages/` must not depend on (routes compose pages, not the other
 * way around — the same reasoning `features/apps/api/useSelectedProjectId.ts`
 * gives for avoiding `src/routes/$projectId.$.tsx`). `entities/project`'s
 * `isPublicProject(a, b)` selector plus `shared/config`'s `getConfig()` are
 * both legitimately-downward imports from `pages/`, so the two-line body is
 * reproduced here instead of duplicated as a private local copy.
 */
export function isPublicAgentsProject(projectId: string | undefined): boolean {
  if (projectId === undefined) return false;
  const config = getConfig();
  if (config.status !== 'ok') return false;
  return isPublicProject(projectId, config.config.vite_public_project_id);
}
