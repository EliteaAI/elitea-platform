/**
 * Hand-written REST client for the configurations domain (settings:
 * environment variables + service prompts).
 *
 * Source: `apps/elitea-ui/src/api/configurations.js` — RTK Query endpoints
 * (`getConfigurationsList` / `getAvailableConfigurationsType` /
 * `createConfiguration` / `updateConfiguration`). Every route maps to real
 * Go handlers under `/configurations/configurations/{project_id}`.
 *
 * The generated `admin.ts` does NOT include these endpoints (they live on
 * a different route namespace), so this is a handwritten client following
 * the same shape as `entities/secret/api/secretApi.ts`.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';

/* ── type shapes ──────────────────────────────────────────────────────── */

/** A single configuration item returned by the server. */
export interface ConfigurationItem {
  readonly id: number;
  readonly project_id: string;
  readonly elitea_title: string;
  readonly label: string;
  readonly type: string;
  readonly section: string;
  readonly shared: boolean;
  readonly data: Record<string, unknown>;
  readonly created_at?: string;
  readonly updated_at?: string;
}

/** Paginated list response envelope. */
export interface ConfigurationsListResponse {
  items: ConfigurationItem[];
  total: number;
  offset: number;
  limit: number;
}

/** Schema returned by the available-configurations-type endpoint. */
export interface AvailableConfigurationType {
  type: string;
  config_schema?: Record<string, unknown>;
}

/** Params for `getConfigurationsList`. */
export interface ConfigurationsListParams {
  readonly projectId: string;
  readonly section: string;
  readonly includeShared?: boolean;
  readonly pageSize?: number;
}

/** Params for `getAvailableConfigurationsType`. */
export interface AvailableConfigurationsTypeParams {
  readonly section: string;
}

/** Body shape for `createConfiguration`. */
export interface CreateConfigurationBody {
  readonly elitea_title: string;
  readonly label: string;
  readonly type: string;
  readonly shared: boolean;
  readonly data: Record<string, unknown>;
}

/** Body shape for `updateConfiguration`. */
export interface UpdateConfigurationBody {
  readonly label: string;
  readonly shared: boolean;
  readonly data: Record<string, unknown>;
}

/* ── transport helpers ────────────────────────────────────────────────── */

/* The Go handler mounts at /configurations with inner routes /configurations/…
   (handler.go:37-40), so the full API path is /configurations/configurations/{id}.
   The old app does NOT use a mode prefix for configurations. */
function configurationsPath(projectId: string): string {
  return `/configurations/configurations/${projectId}`;
}

function availableTypesPath(): string {
  return `/configurations/available/`;
}

/* ── query keys ───────────────────────────────────────────────────────── */

function configurationsListKey(params: ConfigurationsListParams): string[] {
  return ['settings', 'configurations', params.projectId, params.section];
}

function availableTypesKey(section: string): string[] {
  return ['settings', 'availableTypes', section];
}

/* ── getConfigurationsList — GET /configurations/configurations/{project_id} */
/* manifest: configurations.list */

export async function getConfigurationsList(
  params: ConfigurationsListParams,
): Promise<ConfigurationsListResponse> {
  const qs = new URLSearchParams({
    section: params.section,
    include_shared: String(params.includeShared ?? false),
    limit: String(params.pageSize ?? 100),
    offset: '0',
    sort_by: 'created_at',
    sort_order: 'desc',
  });
  const resp = await eliteaFetch<ConfigurationsListResponse>(
    `${configurationsPath(params.projectId)}?${qs}`,
  );
  return resp;
}

export function useGetConfigurationsListQuery(
  params: ConfigurationsListParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<ConfigurationsListResponse, Error> {
  return useQuery({
    queryKey: configurationsListKey(params),
    queryFn: () => getConfigurationsList(params),
    enabled: options.enabled ?? true,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

/* ── getAvailableConfigurationsType — GET /configurations/available/?section=... */
/* manifest: configurations.availableTypes */

export async function getAvailableConfigurationsType(
  params: AvailableConfigurationsTypeParams,
): Promise<AvailableConfigurationType[]> {
  const qs = new URLSearchParams({ section: params.section });
  const resp = await eliteaFetch<AvailableConfigurationType[]>(
    `${availableTypesPath()}?${qs}`,
  );
  return resp;
}

export function useGetAvailableConfigurationsTypeQuery(
  params: AvailableConfigurationsTypeParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<AvailableConfigurationType[], Error> {
  return useQuery({
    queryKey: availableTypesKey(params.section),
    queryFn: () => getAvailableConfigurationsType(params),
    enabled: options.enabled ?? true,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

/* ── createConfiguration — POST /configurations/configurations/{project_id} */
/* manifest: configurations.create */

export async function createConfiguration(
  projectId: string,
  body: CreateConfigurationBody,
): Promise<void> {
  await eliteaFetch<unknown>(configurationsPath(projectId), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useCreateConfigurationMutation(
  projectId: string,
): UseMutationResult<void, Error, CreateConfigurationBody> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => createConfiguration(projectId, body),
    onSuccess: () => {
      // Invalidate all configuration queries for this project
      void queryClient.invalidateQueries({ queryKey: ['settings', 'configurations'] });
      void queryClient.invalidateQueries({ queryKey: ['settings', 'availableTypes'] });
    },
  });
}

/* ── updateConfiguration — PUT /configurations/configurations/{id} ────────── */
/* manifest: configurations.update */

export interface UpdateConfigurationArgs {
  readonly configId: string;
  readonly body: UpdateConfigurationBody;
}

export async function updateConfiguration(
  { configId, body }: UpdateConfigurationArgs,
): Promise<void> {
  await eliteaFetch<unknown>(
    `/configurations/configurations/${configId}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export function useUpdateConfigurationMutation(
  projectId: string,
): UseMutationResult<void, Error, UpdateConfigurationArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateConfigurationArgs) =>
      updateConfiguration({ configId: args.configId, body: args.body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', 'configurations', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['settings', 'availableTypes'] });
    },
  });
}

/* ── listModels — GET /configurations/configurations/{project_id}?section=models ── */
/* manifest: configurations.listModels */

/**
 * Model entry returned by the configurations endpoint when queried for models.
 * Mirrors the shape returned by `useListModelsQuery` from the old app's
 * `@/api/configurations.js`.
 */
export interface ConfigModel {
  readonly name: string;
  readonly project_id: string;
  readonly default?: boolean;
  readonly display_name?: string;
  readonly id?: string | number;
  readonly uid?: string;
  [key: string]: unknown;
}

/** Response envelope for the models list query. */
export interface ConfigModelsListResponse {
  items: ConfigModel[];
  default_model_name: string;
}

export interface ListModelsParams {
  readonly projectId: string;
  readonly include_shared?: boolean;
}

export async function listModels(
  params: ListModelsParams,
): Promise<ConfigModelsListResponse> {
  const qs = new URLSearchParams({
    section: 'models',
    include_shared: String(params.include_shared ?? false),
    limit: '100',
    offset: '0',
    sort_by: 'created_at',
    sort_order: 'desc',
  });
  const resp = await eliteaFetch<ConfigModelsListResponse>(
    `${configurationsPath(params.projectId)}?${qs}`,
  );
  return resp;
}

export function useListModelsQuery(
  params: ListModelsParams,
  options?: { enabled?: boolean; skip?: boolean },
): UseQueryResult<ConfigModelsListResponse, Error> {
  return useQuery({
    queryKey: ['models', params.projectId],
    queryFn: () => listModels(params),
    enabled: options?.enabled ?? (options?.skip ? !options.skip : true),
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}
