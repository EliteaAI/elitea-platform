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
import type { Project as GeneratedProject } from '@/shared/api/generated/model';
import type { Project } from '@/entities/project';

import { orderedProjectOptions } from '../lib/projectOptions';

export interface ProjectOptionsResult {
  readonly projects: readonly Project[];
  readonly isLoading: boolean;
}

/**
 * The generated `Project` (zod-inferred, `description?`/`role?` typed as
 * `T | undefined` under `exactOptionalPropertyTypes`) and `entities/
 * project`'s hand-authored `Project` (`description?`/`role?` typed as
 * plain `T`, no explicit `undefined` in the union) are structurally close
 * but not assignment-compatible under `exactOptionalPropertyTypes` — the
 * generated shape may carry an explicit `undefined` value the hand-typed
 * one forbids. An explicit field-by-field map, not a cast, is the
 * type-safe boundary crossing.
 */
function toEntityProject(project: GeneratedProject): Project {
  return {
    id: project.id,
    name: project.name,
    ...(project.description !== undefined ? { description: project.description } : {}),
    status: project.status,
    ...(project.role !== undefined ? { role: project.role } : {}),
    suspended: project.suspended,
  };
}

export function useProjectOptions(publicProjectId: string): ProjectOptionsResult {
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
    return orderedProjectOptions(list.map(toEntityProject), publicProjectId);
  }, [query.data, publicProjectId]);

  return { projects, isLoading: query.isLoading };
}
