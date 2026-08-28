/**
 * Project-switcher ordering (old app: `components/ProjectSelect.jsx`'s
 * `projectOptions` useMemo — the public project pinned first, then the rest
 * alphabetically). Reduced scope, documented:
 *
 *  - The caller's private/personal project is pinned second. Its identity
 *    comes from `GET /social/author`'s `personal_project_id`, the same source
 *    the old app used. Project-list rows do not carry this marker themselves.
 *  - The reserved public and personal storage names (`promptlib_public` and
 *    `project_user_<id>`) are presentation details. The old app renders them
 *    as `Public` and `Private`; the new UI must not expose them to users.
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
  personalProjectId?: string,
): readonly Project[] {
  const namedProjects = projects.map((project) => {
    if (isPublicProject(project.id, publicProjectId)) return { ...project, name: 'Public' };
    if (personalProjectId !== undefined && String(project.id) === personalProjectId) {
      return { ...project, name: 'Private' };
    }
    return project;
  });
  const publicProject = namedProjects.find((project) => isPublicProject(project.id, publicProjectId));
  const privateProject = namedProjects.find(
    (project) =>
      personalProjectId !== undefined &&
      String(project.id) === personalProjectId &&
      project !== publicProject,
  );
  const rest = sortProjectsByName(
    namedProjects.filter((project) => project !== publicProject && project !== privateProject),
  );
  return [publicProject, privateProject, ...rest].filter((project): project is Project => project !== undefined);
}
