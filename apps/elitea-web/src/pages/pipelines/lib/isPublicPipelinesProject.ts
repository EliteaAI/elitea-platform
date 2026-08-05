import { isPublicProject } from '@/entities/project';
import { getConfig } from '@/shared/config';

/**
 * `projectId == PUBLIC_PROJECT_ID` (old app: `pages/Pipelines/Pipelines.jsx`
 * reads `useSelectedProjectId()` and compares against `PUBLIC_PROJECT_ID`,
 * `common/constants.js:61` — `PUBLIC_PROJECT_ID = +VITE_PUBLIC_PROJECT_ID`),
 * reproduced for `pages/pipelines/**` specifically — same body, same
 * duplication rationale as `pages/agents/lib/isPublicAgentsProject.ts`
 * (Wave-2 unit A1g): `src/routes/-guards/publicProject.ts` lives in a layer
 * `pages/` must not depend on, so the two-line body (both legitimately
 * downward `entities/project`/`shared/config` imports) is reproduced here
 * instead of imported across a `pages/`-to-`routes/` boundary.
 */
export function isPublicPipelinesProject(projectId: string | undefined): boolean {
  if (projectId === undefined) return false;
  const config = getConfig();
  if (config.status !== 'ok') return false;
  return isPublicProject(projectId, config.config.vite_public_project_id);
}
