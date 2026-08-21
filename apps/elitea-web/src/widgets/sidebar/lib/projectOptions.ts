/**
 * Project-switcher ordering (old app: `components/ProjectSelect.jsx`'s
 * `projectOptions` useMemo — the public project pinned first, then the rest
 * alphabetically). Reduced scope, documented:
 *
 *  - The old app ALSO pins the caller's private/personal project second
 *    (`privateProject`, keyed off Redux `state.user.personal_project_id`).
 *    The new backend's project body (W2, `ProjectWithGroups`, marshaled by
 *    `internal/api/v2/projects/handler.go:134-143`) carries no "this is your
 *    personal project" flag at all. This port does not guess at
 *    undocumented backend semantics (§3.6/RIGOR: no fabricated behaviour).
 *    Every project other than the public one is therefore sorted
 *    alphabetically via `entities/project`'s already-ported
 *    `sortProjectsByName`, with no second pin.
 *  - `filterIds`/`hasPublicProjectAccess` (old app: gates whether the
 *    public project even appears) are dropped — `hasPublicProjectAccess`
 *    reads a permission this port has no evidence for
 *    (`usePublicProjectAccessCheck`, `[fsd]/features/project/lib/hooks`, not
 *    ported). The public project is always included when the API returns
 *    it.
 */
import type { Project } from '@/entities/project';
import { isPublicProject, sortProjectsByName } from '@/entities/project';

export function orderedProjectOptions(
  projects: readonly Project[],
  publicProjectId: string,
): readonly Project[] {
  const publicProject = projects.find((project) => isPublicProject(project.id, publicProjectId));
  const rest = sortProjectsByName(projects.filter((project) => project !== publicProject));
  return publicProject ? [publicProject, ...rest] : rest;
}
