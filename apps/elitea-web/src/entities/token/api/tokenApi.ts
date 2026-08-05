/**
 * Hand-written REST client for the personal access tokens domain (settings
 * section — PERSONAL tokens tab).
 *
 * Source: `apps/elitea-ui/src/api/auth.js` — RTK Query endpoints
 * (`tokenList` / `tokenCreate` / `tokenDelete`). Every route below maps to a
 * real, wired Go handler (`services/elitea-main/internal/api/v2/auth/
 * handler.go:30-32`):
 *
 *   - GET  `/auth/token/`             → list
 *   - POST `/auth/token/`             → create
 *   - DELETE `/auth/token/{tokenUUID}` → delete
 *
 * WHY HAND-WRITTEN, NOT GENERATED: personal access tokens do not appear in
 * `services/elitea-main/api/openapi/v2.yaml` (spec-coverage gap for the
 * settings domain). This follows the same handwritten-manifest rationale as
 * `entities/secret/api/secretApi.ts`.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';

import type { PersonalAccessToken } from '../model/types';

/* ── transport helpers ─────────────────────────────────────────────────── */

/** Unwrap the `{ data: <T> }` envelope the Go handler returns. */
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(path, init);
  return envelope.data;
}

/* ── query key ─────────────────────────────────────────────────────────── */

function tokensQueryKey(): string[] {
  return ['settings', 'personal', 'tokens'];
}

/* ── tokenList — GET /auth/token/ ──────────────────────────────────────── */
/* manifest: tokens.list */

export async function listTokens(): Promise<readonly PersonalAccessToken[]> {
  return fetchJson<readonly PersonalAccessToken[]>('/auth/token/');
}

export function useListTokensQuery(options: { enabled?: boolean } = {}): UseQueryResult<readonly PersonalAccessToken[], Error> {
  return useQuery({
    queryKey: tokensQueryKey(),
    queryFn: listTokens,
    enabled: options.enabled ?? true,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

/* ── tokenCreate — POST /auth/token/ ───────────────────────────────────── */
/* manifest: tokens.create */

export interface CreateTokenParams {
  readonly name: string;
  /** `null` for never-expiring, or `{ measure, value }` for time-bound. */
  readonly expires: { measure: string; value: number } | null;
}

export interface CreatedTokenResponse {
  readonly uuid: string;
  readonly name: string;
  readonly token: string;
  readonly expires: string | null;
}

export async function createToken(params: CreateTokenParams): Promise<CreatedTokenResponse> {
  return eliteaFetch<CreatedTokenResponse>('/auth/token/', {
    method: 'POST',
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useCreateTokenMutation(): UseMutationResult<CreatedTokenResponse, Error, CreateTokenParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createToken,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: tokensQueryKey() }),
  });
}

/* ── tokenDelete — DELETE /auth/token/{tokenUUID} ──────────────────────── */
/* manifest: tokens.delete */

export async function deleteToken(tokenUUID: string): Promise<void> {
  await eliteaFetch<unknown>(`/auth/token/${encodeURIComponent(tokenUUID)}`, {
    method: 'DELETE',
  });
}

export function useDeleteTokenMutation(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uuid: string) => deleteToken(uuid),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: tokensQueryKey() }),
  });
}
