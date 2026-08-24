/**
 * REST client for the admin LLM Proxy section's **Providers** tab —
 * `/api/v2/admin/gateway/providers`.
 *
 * ## What a "global provider" is
 *
 * A platform-wide provider credential is a row in the PUBLIC project's schema
 * with `shared = true`. The LLM gateway already resolves that scope for every
 * request — the caller's own project, plus the public project's shared rows
 * (issue #316) — so a credential published here is usable by every project on
 * the platform without any project configuring it.
 *
 * That is the same mechanism, not a new one. Nothing about the credential model
 * changed to make this screen possible; what was missing was a surface, because
 * publishing one previously meant knowing that "project 1, ticked shared" is the
 * global scope and being a member of that project.
 *
 * ## The secret is never on the wire, in either direction, more than once
 *
 * A read NEVER returns secret material — not the value, and not even the
 * `{{secret.NAME}}` reference. What comes back is which secret fields are SET
 * and whether each is SEALED. So there is nothing to pre-fill an edit form with,
 * and leaving a secret field untouched on an edit sends no secret at all and
 * keeps the stored one — the same contract `./adminMcpServersApi` keeps for a
 * client secret, and for the same reason.
 *
 * A write sends the plaintext once. The server seals it into the public
 * project's vault inside the same transaction that writes the row, so the row
 * holds a reference and never the key.
 *
 * ## `status_ok` is the field that decides whether anything happens
 *
 * The gateway admits `status_ok = true` and nothing else. The server runs
 * provider admission on every write, so a credential that does not resolve is
 * stored, listed, and completely inert. That state has no other display anywhere,
 * which is why it is a column on this table rather than a detail.
 *
 * Not generated: `orval` builds from `v2.yaml`, which does not describe the
 * admin-panel routes.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import { unwrapBody } from '@/shared/api/unwrap';

const PROVIDERS_URL = '/admin/gateway/providers';

/**
 * Every credential type this app knows how to draw a form for.
 *
 * IT IS NOT THE LIST THE SELECT OFFERS. What a deployment will actually publish
 * comes from the server, as `provider_types` on the listing, and is narrower:
 * the gateway can dispatch to nine types while the pinned configuration
 * catalogue describes six, and a type outside the catalogue cannot be given a
 * `section` or have its key sealed. This list exists so the form has field
 * definitions ready when a deployment's catalogue grows — see
 * `../llmProviderForm.ts`.
 *
 * The server's refusal is the security boundary, never this list.
 */
export const LLM_PROVIDER_TYPES = [
  'open_ai',
  'azure_open_ai',
  'open_ai_azure',
  'ai_dial',
  'anthropic',
  'ollama',
  'amazon_bedrock',
  'vertex_ai',
  'vllm',
] as const;

export type LlmProviderType = (typeof LLM_PROVIDER_TYPES)[number];

/** One secret field's status. The value itself is never sent. */
export interface LlmProviderSecret {
  readonly field: string;
  readonly set: boolean;
  /**
   * False when the row holds the value literally rather than as a vault
   * reference — a finding, because such a row is readable by every holder of
   * the project-scoped configuration permissions on the public project.
   */
  readonly sealed: boolean;
}

export interface LlmProvider {
  readonly id: number;
  readonly uuid: string;
  readonly elitea_title: string;
  readonly label: string;
  readonly type: string;
  /** The gateway admits this credential only when true. */
  readonly status_ok: boolean;
  readonly status_logs: string;
  /** `api_base` — not a secret. */
  readonly endpoint: string;
  /** The remaining non-secret fields, by provider. */
  readonly settings: Readonly<Record<string, string>>;
  readonly secrets: readonly LlmProviderSecret[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface LlmProviderList {
  readonly items: readonly LlmProvider[];
  readonly total: number;
  /**
   * The credential types THIS deployment will publish, from its own catalogue.
   * Read rather than assumed: a hardcoded client list drifts from the registry
   * snapshot, and the drift shows up as a refusal on save rather than as an
   * absent option.
   */
  readonly provider_types: readonly string[];
  /**
   * Which project this deployment treats as the shared one. Echoed so an
   * operator can confirm it: getting it wrong is the failure where every
   * credential is published correctly into a schema the gateway never reads.
   */
  readonly public_project_id: number;
}

/**
 * What the provider dialog sends.
 *
 * `data` carries the provider fields — `api_base`, `api_key` and the
 * per-provider extras. A secret key is present ONLY when the operator entered
 * one: on an edit, an absent key means "keep what is stored", and sending an
 * empty string instead would clear a working credential.
 */
export interface LlmProviderDraft {
  readonly elitea_title: string;
  readonly type: LlmProviderType;
  readonly data: Readonly<Record<string, string | boolean>>;
}

const providerKeys = {
  all: ['admin', 'llmProxy', 'providers'] as const,
};

/** `GET /admin/gateway/providers`. */
export function useAdminLlmProviders(): UseQueryResult<LlmProviderList, Error> {
  return useQuery({
    queryKey: providerKeys.all,
    queryFn: async (): Promise<LlmProviderList> => {
      const body = unwrapBody(await eliteaFetch<unknown>(PROVIDERS_URL)) as
        | LlmProviderList
        | undefined;
      return {
        items: body?.items ?? [],
        total: body?.total ?? 0,
        public_project_id: body?.public_project_id ?? 0,
        provider_types: body?.provider_types ?? [],
      };
    },
  });
}

/**
 * `POST /admin/gateway/providers`.
 *
 * `shared` is NOT sent. The server forces it — and refuses an explicit `false`
 * rather than overriding it — so a client that sent the field would either be
 * restating the server's rule or be refused for contradicting it.
 */
export function useCreateAdminLlmProvider(): UseMutationResult<void, Error, LlmProviderDraft> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: LlmProviderDraft) => {
      await eliteaFetch<unknown>(PROVIDERS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.all }),
  });
}

/**
 * `PUT /admin/gateway/providers/{id}` — a PARTIAL update.
 *
 * Only the fields the body carries are written. That is the delegated handler's
 * contract and it is load-bearing here: sending a whole `data` object on an
 * edit whose secret field the operator left blank would erase the stored key.
 */
export function useUpdateAdminLlmProvider(): UseMutationResult<
  void,
  Error,
  { readonly id: number; readonly draft: Partial<LlmProviderDraft> }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft }) => {
      await eliteaFetch<unknown>(`${PROVIDERS_URL}/${String(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.all }),
  });
}

/**
 * `DELETE /admin/gateway/providers/{id}`.
 *
 * Deleting a platform credential withdraws it from EVERY project at once,
 * including projects whose models name it. There is no cheap way to count those
 * — they live in one schema per project — so the dialog says so rather than
 * reporting a number it would have to invent.
 */
export function useDeleteAdminLlmProvider(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await eliteaFetch<unknown>(`${PROVIDERS_URL}/${String(id)}`, { method: 'DELETE' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providerKeys.all }),
  });
}
