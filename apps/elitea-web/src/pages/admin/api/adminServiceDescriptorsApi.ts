/**
 * REST client for the admin SERVICE DESCRIPTORS surface — unit A14, issue #200.
 *
 * ONE call: the listing. The reference client (`admin_ui`'s
 * `serviceDescriptorsApi.js`) declares two — the listing and a delete — and the
 * delete is not declared here because there is nothing to delete: the server
 * refuses both registration verbs, and a mutation hook that exists is a mutation
 * hook a control can be wired to. See `../ServiceDescriptors.tsx` for why the
 * whole surface is unavailable.
 *
 * Not generated: `orval` builds from `v2.yaml`, which does not describe the
 * admin-panel routes. Handwritten in the same shape as `./adminConfigurationApi.ts`.
 *
 * The wire contract mirrors the Go handler in
 * `services/elitea-main/internal/api/v2/eliteacore/service_descriptors.go`, which
 * keeps pylon's path and mode (`legacy/plugins/elitea_core/api/v2/admin.py`) so
 * the existing admin_ui client reaches the same endpoint unchanged — and now gets
 * the same honest 501 rather than three invented rows.
 *
 * ## What is reused
 *
 * `unwrapBody` (added by the Users port) and `configFailureReason` /
 * `configFailureStatus` from `./adminConfigurationApi`. Those two readers are
 * exactly this page's need — it renders the server's own sentence and has to tell
 * 501 from a load failure — and re-deriving them here would be a second copy to
 * drift. Nothing else: a different endpoint and its own query-key namespace.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import { unwrapBody } from '@/shared/api/unwrap';

import { configFailureReason, configFailureStatus } from './adminConfigurationApi';

/**
 * Only `administration` reads this, server-side and in pylon before it —
 * `api_tools.APIBase` registers `mode_handlers = {'administration': AdminAPI}`
 * and no other mode. It is a static path segment on both sides rather than a
 * parameter, so there is no mode a caller could substitute.
 */
const ADMIN_MODE = 'administration';

const DESCRIPTORS_URL = `/elitea_core/admin/${ADMIN_MODE}`;

/**
 * One row of pylon's `GET /elitea_core/admin/administration`.
 *
 * Declared even though this deployment never returns one: it is the shape the
 * page would render, and writing it down is what makes the difference between
 * "unavailable" and "unimplemented" reviewable. Note that `healthy` is not a
 * stored fact anywhere — in pylon it records which of two in-process dicts the
 * descriptor landed in after a health probe at plugin load.
 */
export interface AdminServiceDescriptor {
  readonly project_id: number;
  readonly provider_name: string;
  readonly service_location_url: string;
  readonly healthy: boolean;
}

/** The listing body pylon returns. `rows` is what the reference client reads. */
interface AdminServiceDescriptorList {
  readonly rows?: readonly AdminServiceDescriptor[];
  readonly total?: number;
}

/**
 * One query-key namespace, declared once — the read/write key-namespace split
 * that made saved data look absent in #132.
 *
 * Not exported. There is no write to invalidate it and no other module that
 * reads this listing, so an export would be a symbol with no importer — the
 * dead-code shape this unit has removed six times (see #126/#129/#134/#136/
 * #138/#149). `ServiceDescriptors.test.tsx` pins the namespace by asserting the
 * literal key against the query cache, which is a stronger pin than importing
 * the builder: a literal does not move when the builder does.
 */
const adminServiceDescriptorKeys = {
  list: () => ['admin', 'service-descriptors', 'list'] as const,
};

/**
 * `GET /elitea_core/admin/administration`.
 *
 * Expected to FAIL with 501 on this platform, and the failure is the page's
 * content. `retry: false` because a declared-unavailable surface is not a
 * transient error and retrying it three times only delays the explanation.
 */
export function useAdminServiceDescriptors(): UseQueryResult<
  readonly AdminServiceDescriptor[],
  Error
> {
  return useQuery({
    queryKey: adminServiceDescriptorKeys.list(),
    retry: false,
    queryFn: async (): Promise<readonly AdminServiceDescriptor[]> => {
      // `eliteaFetch` resolves the transport envelope, not the body. Reading
      // `rows` off the envelope is #132's silent empty state — and on this page
      // it would be worse than empty: an unwrapped envelope has no `rows`, so
      // the page would render "no descriptors" instead of the reason, which is
      // precisely the "looks fine, is wrong" outcome this port exists to remove.
      const body = unwrapBody(await eliteaFetch<unknown>(DESCRIPTORS_URL)) as
        | AdminServiceDescriptorList
        | undefined;
      return body?.rows ?? [];
    },
  });
}

/**
 * The server's own explanation of a refusal, and its status.
 *
 * Re-exported rather than re-derived: `EliteaApiError`'s failure shape is one
 * thing, and two readers of it would be two things to keep in step.
 */
export { configFailureReason as descriptorFailureReason, configFailureStatus as descriptorFailureStatus };
