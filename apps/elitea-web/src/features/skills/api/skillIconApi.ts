/**
 * Skill icon gallery, upload, bind and delete.
 *
 * Baseline: `apps/elitea-ui/src/[fsd]/features/skill/api/skillsApi.js`
 * (`getSkillIcons` / `uploadSkillIcon` / `replaceSkillIcon` / `deleteSkillIcon`)
 * — parity manifest API-070 … API-073.
 *
 * Hand-written rather than generated for the same reason
 * `entities/project/api/projectContextApi.ts` is: these four live under
 * `/elitea_core/upload_skill_icon/prompt_lib/{projectId}` and are not part of
 * the generated `applications.ts` surface.
 *
 * ONE SHAPE NOTE THAT IS LOAD-BEARING. The listing answers `{rows, total}` and
 * `eliteaFetch` resolves the `{data, status, headers}` envelope, so a call site
 * that types the fetch as the BODY gets `undefined` fields on a 200 — the #132
 * defect, which shows as an empty gallery with nothing in the console. The
 * unwrap goes through the one sanctioned helper (R-A6), never re-derived here.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import { unwrapListPage } from '@/shared/api/unwrap';

/** One entry of the uploaded-icon gallery. */
interface SkillIcon {
  readonly name: string;
  readonly url: string;
}

/**
 * The payload the upload answers and the bind (PUT) sends back. `name` and
 * `url` are what the server requires; the rest is presentational metadata the
 * baseline carries through unchanged.
 */
export interface SkillIconMeta {
  readonly name: string;
  readonly url: string;
  readonly size?: string;
  readonly initial_file_size?: string;
  readonly resulting_file_size?: string;
}

export interface SkillIconsPage {
  readonly rows: readonly SkillIcon[];
  readonly total: number;
}

const skillIconQueryKey = (projectId: string): readonly string[] => ['skills', projectId, 'icons'];

function iconBase(projectId: string): string {
  return `/elitea_core/upload_skill_icon/prompt_lib/${projectId}`;
}

async function fetchBody<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

/* ── list — GET /upload_skill_icon/prompt_lib/{projectId} ───────────────── */
/* manifest: API-070 (getSkillIcons) */

export async function fetchSkillIcons(
  projectId: string,
  page = 0,
  pageSize = 200,
): Promise<SkillIconsPage> {
  const url = `${iconBase(projectId)}?limit=${String(pageSize)}&skip=${String(page * pageSize)}`;
  return unwrapListPage<SkillIcon>(await eliteaFetch<unknown>(url, { method: 'GET' }), 'skillIcons.list');
}

export function useSkillIconsQuery(
  projectId: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<SkillIconsPage, Error> {
  return useQuery({
    queryKey: skillIconQueryKey(projectId),
    queryFn: () => fetchSkillIcons(projectId),
    enabled: options.enabled ?? !!projectId,
    refetchOnWindowFocus: false,
  });
}

/* ── upload — POST /upload_skill_icon/prompt_lib/{projectId}[/{versionId}] ─ */
/* manifest: API-071 (uploadSkillIcon) */

export interface UploadSkillIconParams {
  readonly file: File;
  readonly width?: number;
  readonly height?: number;
  /**
   * When present the icon is bound to that skill version by the SAME request.
   * The baseline's dynamic path template — the trailing segment is optional.
   */
  readonly versionId?: string;
}

export async function uploadSkillIcon(
  projectId: string,
  params: UploadSkillIconParams,
): Promise<SkillIconMeta> {
  const form = new FormData();
  form.append('file', params.file);
  if (params.width !== undefined) form.append('width', String(params.width));
  if (params.height !== undefined) form.append('height', String(params.height));
  const suffix = params.versionId ? `/${params.versionId}` : '';
  return fetchBody<SkillIconMeta>(`${iconBase(projectId)}${suffix}`, { method: 'POST', body: form });
}

export function useUploadSkillIconMutation(
  projectId: string,
): UseMutationResult<SkillIconMeta, Error, UploadSkillIconParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params) => uploadSkillIcon(projectId, params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillIconQueryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}

/* ── bind — PUT /upload_skill_icon/prompt_lib/{projectId}/{versionId} ────── */
/* manifest: API-072 (replaceSkillIcon) */

export interface BindSkillIconParams {
  readonly versionId: string;
  /** `null` resets the version to the default icon, as the baseline's empty name/url pair does. */
  readonly iconMeta: SkillIconMeta | null;
}

export async function bindSkillIcon(
  projectId: string,
  params: BindSkillIconParams,
): Promise<void> {
  // The server requires `name` and `url` to be present strings; a reset sends
  // them empty rather than omitting them, which is exactly what pylon's
  // UpdateIcon model accepts.
  const body = params.iconMeta ?? { name: '', url: '' };
  await fetchBody<unknown>(`${iconBase(projectId)}/${params.versionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function useBindSkillIconMutation(
  projectId: string,
): UseMutationResult<void, Error, BindSkillIconParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params) => bindSkillIcon(projectId, params),
    // The skill detail and every list that renders the icon read
    // `version_details.meta.icon_meta`, so they are what a successful bind
    // changes — the gallery itself is unaffected.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}

/* ── delete — DELETE /upload_skill_icon/prompt_lib/{projectId}/{name} ────── */
/* manifest: API-073 (deleteSkillIcon) */

export async function deleteSkillIcon(projectId: string, name: string): Promise<void> {
  await eliteaFetch<unknown>(`${iconBase(projectId)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

export function useDeleteSkillIconMutation(
  projectId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name) => deleteSkillIcon(projectId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillIconQueryKey(projectId) });
      // The delete also unlinks the icon from every skill version wearing it,
      // so the skill reads are stale too. Not invalidating them is how a
      // deleted icon keeps rendering as a broken image until a hard reload.
      void queryClient.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}
