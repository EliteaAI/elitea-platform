/**
 * Thin wrapper over the generated `useListProjects` hook (S4, `shared/api/
 * generated/applications/applications.ts`; endpoint `GET /projects/project/
 * default/{publicProjectId}` — API-173). Reduced to the ordered `Project[]`
 * this widget's project switcher renders; `../lib/projectOptions.ts` owns
 * the (independently tested) ordering rule.
 *
 * `query.data` is the enveloped `{data, status, headers}` shape declared by
 * `listProjectsResponse` — `eliteaFetch` (`shared/api/generated/mutator.ts`)
 * was fixed at the source (2026-07-27) to actually build that envelope
 * rather than resolving with the bare body; this reads through `.data`.
 */
import { useMemo } from 'react';

import { useListProjects } from '@/shared/api/generated/applications/applications';
import type { ProjectWithGroups as GeneratedProject } from '@/shared/api/generated/model';
import type { Project } from '@/entities/project';

import { orderedProjectOptions } from '../lib/projectOptions';

export interface ProjectOptionsResult {
  readonly projects: readonly Project[];
  readonly isLoading: boolean;
}

/**
 * The generated `ProjectWithGroups` carries five more fields than the switcher
 * renders (`owner_id`, `plugins`, `keycloak_groups`, `create_success`,
 * `groups`). An explicit field-by-field map, not a cast, is the type-safe
 * boundary crossing: it keeps `entities/project`'s `Project` to what this
 * widget reads, and it fails to compile if the wire shape loses a field.
 *
 * The listing used to copy a `status` field too. The spec declared it required
 * but internal/api/v2/projects/handler.go never emitted it, so every project
 * here carried `status: undefined` under a type that promised
 * `'active' | 'suspended'`. `suspended` is the real flag.
 */
function toEntityProject(project: GeneratedProject): Project {
  return {
    id: project.id,
    name: project.name,
    suspended: project.suspended,
  };
}

export function useProjectOptions(publicProjectId: string, personalProjectId?: string): ProjectOptionsResult {
  const numericPublicProjectId = Number(publicProjectId);
  const query = useListProjects(numericPublicProjectId, undefined, {
    query: { enabled: Number.isFinite(numericPublicProjectId) },
  });

  const projects = useMemo(() => {
    // `query.data.data`'s declared type includes the error-envelope variant
    // (`listProjectsResponse401`) — never actually reachable here, since
    // `eliteaFetch` throws instead of resolving with it (mutator.ts's §3.6
    // unwrap contract); react-query's `data` typing doesn't reflect that.
    const list = query.data?.data as GeneratedProject[] | undefined;
    if (!list) return [];
    return orderedProjectOptions(list.map(toEntityProject), publicProjectId, personalProjectId);
  }, [query.data, publicProjectId, personalProjectId]);

  return { projects, isLoading: query.isLoading };
}
