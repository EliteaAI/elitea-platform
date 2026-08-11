/**
 * REST client for the admin CONFIGURATION surface — unit A14, issue #200.
 *
 * Three calls: the section list, one section's values, and the save. The
 * reference client (`admin_ui`'s `configurationApi.js`) declares fifteen; the
 * other twelve drive Pylon runtime administration — plugin reload, remote plugin
 * YAML, plugin updates, pylon log tailing, maintenance splash — and there is
 * nothing here to call. They are not declared in this module at all, and the
 * sections that would have used them render the server's own reason instead.
 * See `../Configuration.tsx`.
 *
 * Not generated: `orval` builds from `v2.yaml`, which does not describe the
 * admin-panel routes. Handwritten in the same shape as `./adminSchedulesApi.ts`.
 *
 * The wire contract mirrors the Go handler in
 * `services/elitea-main/internal/api/v2/admin/config_values.go`, which in turn
 * keeps pylon's path, modes and body keys
 * (`legacy/plugins/admin/api/v2/plugin_config_values.py`) so the existing
 * admin_ui client speaks to the same endpoint unchanged.
 *
 * ## What is reused
 *
 * `EliteaApiError`/`eliteaFetch` and the failure-reason reader pattern from
 * `./adminSchedulesApi.ts`. Nothing else: a different endpoint, a different
 * payload shape, its own query-key namespace.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { EliteaApiError, eliteaFetch } from '@/shared/api/generated/mutator';
import { unwrapBody } from '@/shared/api/unwrap';

/** Only `administration` may read or write configuration, server-side and in pylon before it. */
const ADMIN_MODE = 'administration';

const SCHEMAS_URL = `/admin/plugin_config_schemas/${ADMIN_MODE}`;

function sectionValuesUrl(sectionId: string): string {
  return `/admin/plugin_config_values/${ADMIN_MODE}/${encodeURIComponent(sectionId)}`;
}

/**
 * One field of a section, as the server declares it.
 *
 * This is a subset of what the schema carries. The omitted members are real, and
 * omitted because nothing here renders them: `enum_source`/`enum_source_keys`
 * feed suggestion lookups whose endpoint answers 501 (the toolkit registry they
 * read is a Pylon surface), and `sync_targets`/`_is_sync_target` describe fanning
 * a value out to a second pylon. Declaring them would imply this page honours
 * them.
 */
export interface AdminConfigField {
  readonly key: string;
  readonly type: string;
  readonly title: string;
  readonly description?: string;
  readonly format?: string;
  readonly enum?: readonly string[];
  readonly default?: unknown;
  /** Renders the field only while another field in the same section holds a value. */
  readonly visible_when?:
    | { readonly field: string; readonly value: unknown }
    | ReadonlyArray<{ readonly field: string; readonly value: unknown }>;
}

/**
 * One section of `GET /admin/plugin_config_schemas/administration`.
 *
 * `unavailable_reason` is the load-bearing member. The server decides which
 * sections this deployment can serve, because that is a fact about the
 * deployment and a page that decided it locally would drift from what the
 * endpoints actually do — the value endpoints answer 501 with this exact string.
 */
export interface AdminConfigSection {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly AdminConfigField[];
  readonly unavailable_reason?: string;
}

/** The GET body. Not exported: no call site outside this module reads it. */
interface AdminConfigValues {
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * One query-key namespace, declared once.
 *
 * The save invalidates `adminConfigKeys.all`, so a key built ad hoc at a call
 * site would be a cache the write never refreshes — the read/write key-namespace
 * split that made saved data look absent in #132.
 */
const adminConfigKeys = {
  all: ['admin', 'configuration'] as const,
  schemas: () => ['admin', 'configuration', 'schemas'] as const,
  values: (sectionId: string) => ['admin', 'configuration', 'values', sectionId] as const,
};

/**
 * The server's own explanation of a refusal, when it gave one.
 *
 * It carries more weight on this page than on a listing: every one of the
 * server's refusals here is actionable and specific — a link scheme that would
 * execute in a reader's browser, a key the schema does not declare, a section
 * this deployment cannot serve — and collapsing them into "Failed to save" would
 * discard the only sentence that says which.
 *
 * A 401/403 does not arrive here: `shared/api/http.ts` routes both into the
 * single-flight re-auth path and reports `kind: 'auth'`, which carries no body.
 */
export function configFailureReason(error: unknown): string | undefined {
  if (!(error instanceof EliteaApiError)) return undefined;
  const failure = error.failure;
  if (failure.kind !== 'http') return undefined;
  const body = failure.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const reason = (body as { error?: unknown }).error;
  return typeof reason === 'string' && reason !== '' ? reason : undefined;
}

/** The HTTP status of a failure, when it had one. Distinguishes 501 from 4xx. */
export function configFailureStatus(error: unknown): number | undefined {
  if (!(error instanceof EliteaApiError)) return undefined;
  const failure = error.failure;
  return failure.kind === 'http' ? failure.status : undefined;
}

/** `GET /admin/plugin_config_schemas/administration`. */
export function useAdminConfigSections(): UseQueryResult<readonly AdminConfigSection[], Error> {
  return useQuery({
    queryKey: adminConfigKeys.schemas(),
    queryFn: async (): Promise<readonly AdminConfigSection[]> => {
      // `eliteaFetch` resolves the transport envelope, not the body; peeling it
      // by hand at a call site is what R-A6 exists to prevent, and forgetting to
      // peel it at all is #132's silent empty state.
      const body = unwrapBody(await eliteaFetch<unknown>(SCHEMAS_URL)) as
        | { sections?: AdminConfigSection[] }
        | undefined;
      return body?.sections ?? [];
    },
  });
}

/**
 * `GET /admin/plugin_config_values/administration/{section}`.
 *
 * `enabled` is false for a section the server declared unavailable. Fetching it
 * anyway would spend a request to be told 501 — and, worse, would put a failed
 * query behind a pane that already knows why it is empty, so the page would show
 * a load error over an explanation.
 */
export function useAdminConfigValues(
  sectionId: string | undefined,
  enabled: boolean,
): UseQueryResult<Readonly<Record<string, unknown>>, Error> {
  return useQuery({
    queryKey: adminConfigKeys.values(sectionId ?? ''),
    enabled: enabled && sectionId !== undefined && sectionId !== '',
    queryFn: async (): Promise<Readonly<Record<string, unknown>>> => {
      const body = unwrapBody(await eliteaFetch<unknown>(sectionValuesUrl(sectionId ?? ''))) as
        | AdminConfigValues
        | undefined;
      return body?.values ?? {};
    },
  });
}

export interface AdminConfigSave {
  readonly sectionId: string;
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * `PUT /admin/plugin_config_values/administration/{section}`.
 *
 * Sends only the keys the operator changed. The server applies exactly what it
 * is given and leaves the rest alone, so saving one card cannot blank another —
 * and a smaller body is a smaller surface for the validator to refuse over a
 * field nobody touched.
 */
export function useSaveAdminConfigValues(): UseMutationResult<void, Error, AdminConfigSave> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sectionId, values }: AdminConfigSave) => {
      await eliteaFetch<unknown>(sectionValuesUrl(sectionId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminConfigKeys.all }),
  });
}
