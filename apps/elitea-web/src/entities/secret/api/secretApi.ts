/**
 * Hand-written REST client for the secrets domain (settings section).
 *
 * Source: `apps/elitea-ui/src/api/secrets.js` — RTK Query endpoints
 * (`secretsList` / `secretCreate` / `secretShow` / `secretEdit` /
 * `secretDelete` / `secretHide`). Every route below maps to a real,
 * wired Go handler (`services/elitea-main/internal/api/v2/secrets/
 * handler.go:59-67`):
 *
 *  - GET  `/secrets/{mode}/{projectID}`          → list (masked names only)
 *  - POST `/secrets/{mode}/{projectID}`          → create
 *  - GET  `/secret/{mode}/{projectID}/{name}`    → show (plaintext value)
 *  - PUT  `/secret/{mode}/{projectID}/{name}`    → rename / update
 *  - DELETE `/secret/{mode}/{projectID}/{name}`  → delete
 *  - POST `/hide/{mode}/{projectID}/{name}`      → hide (move to
 *    `hidden_secrets`)
 *
 * WHY HAND-WRITTEN, NOT GENERATED: the `/secrets` family does not appear
 * in `services/elitea-main/api/openapi/v2.yaml` (spec-coverage gap), so
 * orval never generates a client. Same handwritten-manifest rationale as
 * `entities/conversation/api/contextManagementApi.ts` — this unit appends
 * one manifest entry per endpoint with `source:"handwritten"` (R-A5).
 *
 * The `/secrets` routes mount under `elitea-main/internal/api/v2/secrets`
 * (handler.go:59-67), NOT under the `/prompt_lib` path segments that
 * context-management uses.  The URL pattern below matches the raw Go
 * handler routes verbatim.
 *
 * Per R-A5, every endpoint below is reported for merge into
 * `src/shared/api/endpoints.manifest.json` as `source: "handwritten"`
 * (not edited directly here — see this unit's report).
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';

import type { Secret, RevealedSecret } from '../model/types';
import { normaliseSecrets } from './normalise';

/* ── transport helpers ─────────────────────────────────────────────────── */

/** Unwrap the `{ data: <T> }` envelope the Go handler returns. */
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(path, init);
  return envelope.data;
}

/** The `mode` parameter used across the project-scoped settings routes. */
const SETTINGS_MODE = 'prompt_lib';

function secretsBasePath(projectId: string | number): string {
  return `/secrets/${SETTINGS_MODE}/${projectId}`;
}

function secretPath(projectId: string | number, name: string): string {
  return `/secret/${SETTINGS_MODE}/${projectId}/${encodeURIComponent(name)}`;
}

function hidePath(projectId: string | number, name: string): string {
  return `/hide/${SETTINGS_MODE}/${projectId}/${encodeURIComponent(name)}`;
}

/* ── query key ─────────────────────────────────────────────────────────── */

function secretsQueryKey(projectId: string): string[] {
  return ['settings', 'secrets', projectId];
}

/* ── secretsList — GET /secrets/{mode}/{projectID} ─────────────────────── */
/* manifest: secrets.list */

export async function listSecrets(projectId: string | number): Promise<Secret[]> {
  return fetchJson<readonly unknown[]>(secretsBasePath(projectId))
    .then((wire) => normaliseSecrets(wire as ReadonlyArray<unknown>));
}

export function useListSecretsQuery(projectId: string, options: { enabled?: boolean } = {}): UseQueryResult<Secret[], Error> {
  return useQuery({
    queryKey: secretsQueryKey(projectId),
    queryFn: () => listSecrets(projectId),
    enabled: options.enabled ?? true,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

/* ── secretCreate — POST /secrets/{mode}/{projectID} ───────────────────── */
/* manifest: secrets.create */

export interface CreateSecretParams {
  readonly name: string;
  readonly value: string;
}

export async function createSecret(projectId: string | number, params: CreateSecretParams): Promise<void> {
  await eliteaFetch<unknown>(secretsBasePath(projectId), {
    method: 'POST',
    body: JSON.stringify({ name: params.name, value: params.value }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useCreateSecretMutation(projectId: string): UseMutationResult<void, Error, CreateSecretParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params) => createSecret(projectId, params),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: secretsQueryKey(projectId) }),
  });
}

/* ── secretShow — GET /secret/{mode}/{projectID}/{name} ────────────────── */
/* manifest: secrets.show */

export async function showSecret(projectId: string | number, name: string): Promise<RevealedSecret> {
  return fetchJson<RevealedSecret>(secretPath(projectId, name));
}

/* ── secretEdit — PUT /secret/{mode}/{projectID}/{name} ────────────────── */
/* manifest: secrets.update */

export interface UpdateSecretParams {
  readonly name: string;
  readonly value: string;
}

export async function updateSecret(projectId: string | number, name: string, params: UpdateSecretParams): Promise<void> {
  await eliteaFetch<unknown>(secretPath(projectId, name), {
    method: 'PUT',
    body: JSON.stringify({ name: params.name, value: params.value }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useUpdateSecretMutation(projectId: string): UseMutationResult<void, Error, { name: string; params: UpdateSecretParams }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, params }) => updateSecret(projectId, name, params),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: secretsQueryKey(projectId) }),
  });
}

/* ── secretDelete — DELETE /secret/{mode}/{projectID}/{name} ───────────── */
/* manifest: secrets.delete */

export async function deleteSecret(projectId: string | number, name: string): Promise<void> {
  await eliteaFetch<unknown>(secretPath(projectId, name), { method: 'DELETE' });
}

export function useDeleteSecretMutation(projectId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name) => deleteSecret(projectId, name),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: secretsQueryKey(projectId) }),
  });
}

/* ── secretHide — POST /hide/{mode}/{projectID}/{name} ─────────────────── */
/* manifest: secrets.hide */

export async function hideSecret(projectId: string | number, name: string): Promise<void> {
  await eliteaFetch<unknown>(hidePath(projectId, name), { method: 'POST' });
}

export function useHideSecretMutation(projectId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name) => hideSecret(projectId, name),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: secretsQueryKey(projectId) }),
  });
}
