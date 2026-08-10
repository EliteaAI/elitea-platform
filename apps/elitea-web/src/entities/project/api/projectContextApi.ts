/**
 * Hand-written REST client for the project context & project info endpoints
 * (settings section).
 *
 * WHY HAND-WRITTEN, NOT GENERATED: these routes live under different URL
 * patterns than the generated `applications.ts` client:
 *
 *   - `GET/PUT /elitea_core/project_info/prompt_lib/{projectId}/project-info`
 *     → project info (name, icon_meta, teammates_count)
 *   - `GET/POST/DELETE /elitea_core/project_icon/prompt_lib/{projectId}`
 *     → uploaded icons for the project
 *   - `POST /elitea_core/generate_project_context_draft/prompt_lib/{projectId}`
 *     → AI-generated context draft
 *
 * The existing `project_context` endpoints (`getProjectContext` /
 * `updateProjectContext`) ARE generated in `applications.ts` because they
 * share the `/prompt_lib/{projectId}/project-context` path with other
 * application-level endpoints.
 *
 * Source: `apps/elitea-ui/src/api/projectContext.js`,
 * `.../api/generateProjectContextDraftApi.js`,
 * `.../features/settings/api/projectInfoApi.js` — RTK Query endpoints.
 *
 * Per R-A5, every endpoint below is documented with a `manifest:` comment.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import { unwrapListPage } from '@/shared/api/unwrap';

/* ── transport helpers ─────────────────────────────────────────────────── */

/**
 * `eliteaFetch<T>` ALWAYS resolves the mutator's `{data, status, headers}`
 * envelope, so the body is `envelope.data` — the same one-line helper every
 * sibling hand-written REST module here already uses (`conversationApi.ts`,
 * `secretApi.ts`, `foldersApi.ts`, …).
 *
 * Every fetcher below used to type the call as `eliteaFetch<XResponse>` and
 * return the result verbatim, i.e. it returned the ENVELOPE typed as the body.
 * `projectInfo?.icon_meta` and `?.teammates_count` were therefore permanently
 * `undefined` (no uploaded project icon ever rendered, the teammates count was
 * always 0), the uploaded-icons grid was permanently empty, and the generated
 * context draft came back blank — all with 200s and nothing in the console.
 * Same defect as the PAT that rendered blank in #132; found while migrating
 * the call sites for that issue.
 */
async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

interface ProjectInfoResponse {
  name?: string;
  icon_meta?: { name: string; url: string } | null;
  teammates_count?: number;
}

interface IconMetaRequest {
  name?: string | null;
  url?: string | null;
}

interface IconUploadResponse {
  name?: string;
  url?: string;
}

/* ── query/mutation keys ───────────────────────────────────────────────── */

function projectInfoQueryKey(projectId: string): string[] {
  return ['project', 'info', projectId];
}

function projectIconsQueryKey(projectId: string): string[] {
  return ['project', 'icons', projectId];
}

function projectContextQueryKey(projectId: string): string[] {
  return ['project', 'context', projectId];
}

/* ── projectInfo — GET /project_info/prompt_lib/{projectId}/project-info ── */
/* manifest: projectInfo.get */

export async function fetchProjectInfo(projectId: string): Promise<ProjectInfoResponse> {
  return fetchData<ProjectInfoResponse>(`/elitea_core/project_info/prompt_lib/${projectId}/project-info`, { method: 'GET' });
}

export function useProjectInfoQuery(
  projectId: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<ProjectInfoResponse, Error> {
  return useQuery({
    queryKey: projectInfoQueryKey(projectId),
    queryFn: () => fetchProjectInfo(projectId),
    enabled: options.enabled ?? !!projectId,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

/* ── updateProjectInfo — PUT /project_info/prompt_lib/{projectId}/project-info */
/* manifest: projectInfo.update */

export async function updateProjectInfo(
  projectId: string,
  icon_meta: IconMetaRequest | null,
): Promise<ProjectInfoResponse> {
  const resp = await fetchData<ProjectInfoResponse>(
    `/elitea_core/project_info/prompt_lib/${projectId}/project-info`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon_meta }),
    },
  );
  return resp;
}

export function useUpdateProjectInfoMutation(projectId: string): UseMutationResult<ProjectInfoResponse, Error, IconMetaRequest | null> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (icon_meta) => updateProjectInfo(projectId, icon_meta),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: projectInfoQueryKey(projectId) }),
  });
}

/* ── getProjectIcons — GET /project_icon/prompt_lib/{projectId} ─────────── */
/* manifest: projectIcons.list */

interface UploadedIcon {
  name: string;
  url: string;
}

interface ProjectIconsResponse {
  rows: UploadedIcon[];
  total: number;
}

export async function fetchProjectIcons(
  projectId: string,
  _page = 0,
  pageSize = 200,
): Promise<ProjectIconsResponse> {
  const url = `/elitea_core/project_icon/prompt_lib/${projectId}?limit=${pageSize}&skip=${_page * pageSize}`;
  // The list body is unwrapped by the one helper (R-A6, #132) — this endpoint
  // answers `{rows,total}`, but that is no longer something this call site has
  // to know, assert, or copy correctly.
  return unwrapListPage<UploadedIcon>(await eliteaFetch<unknown>(url, { method: 'GET' }), 'projectIcons.list');
}

export function useProjectIconsQuery(
  projectId: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<ProjectIconsResponse, Error> {
  return useQuery({
    queryKey: projectIconsQueryKey(projectId),
    queryFn: () => fetchProjectIcons(projectId),
    enabled: options.enabled ?? !!projectId,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

/* ── uploadProjectIcon — POST /project_icon/prompt_lib/{projectId} ──────── */
/* manifest: projectIcons.upload */

export interface UploadIconParams {
  file: File;
  width?: number;
  height?: number;
}

export async function uploadProjectIcon(
  projectId: string,
  params: UploadIconParams,
): Promise<IconUploadResponse> {
  const form = new FormData();
  form.append('file', params.file);
  if (params.width) form.append('width', String(params.width));
  if (params.height) form.append('height', String(params.height));

  return fetchData<IconUploadResponse>(`/elitea_core/project_icon/prompt_lib/${projectId}`, {
    method: 'POST',
    body: form,
  });
}

export function useUploadProjectIconMutation(
  projectId: string,
): UseMutationResult<IconUploadResponse, Error, UploadIconParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params) => uploadProjectIcon(projectId, params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectIconsQueryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectInfoQueryKey(projectId) });
    },
  });
}

/* ── deleteProjectIcon — DELETE /project_icon/prompt_lib/{projectId}/{name} */
/* manifest: projectIcons.delete */

export async function deleteProjectIcon(
  projectId: string,
  name: string,
): Promise<void> {
  await eliteaFetch<unknown>(
    `/elitea_core/project_icon/prompt_lib/${projectId}/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  );
}

export function useDeleteProjectIconMutation(
  projectId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name) => deleteProjectIcon(projectId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectIconsQueryKey(projectId) });
    },
  });
}

/* ── generateProjectContextDraft — POST /generate_project_context_draft/prompt_lib/{projectId} */
/* manifest: draft.generate */

export interface GenerateDraftParams {
  user_description?: string;
}

export interface DraftResponse {
  project_background?: string;
}

export async function generateProjectContextDraft(
  projectId: string,
  params: GenerateDraftParams,
): Promise<DraftResponse> {
  const resp = await fetchData<DraftResponse>(
    `/elitea_core/generate_project_context_draft/prompt_lib/${projectId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    },
  );
  return resp;
}

export function useGenerateProjectContextDraftMutation(
  projectId: string,
): UseMutationResult<DraftResponse, Error, GenerateDraftParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params) => generateProjectContextDraft(projectId, params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectContextQueryKey(projectId) });
    },
  });
}
