import { useCallback, useMemo, useState } from 'react';

import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';

import {
  createModerationRequest,
  getModerationStatusQueryOptions,
} from '@/shared/api/generated/admin/admin';
import type { IgnoredRequestBody, ModerationStatusResponse } from '@/shared/api/generated/model';

import { APPLICATION_CATALOG, REQUEST_STATUS } from '../lib/constants';
import type { RequestStatus } from '../lib/constants';

import { useSelectedProjectId } from './useSelectedProjectId';

/**
 * The Go admin-moderation endpoints (`/admin/moderation_status/default/
 * {project_id}/{entity_id}`, both GET and POST — unit W2's own generated
 * comment: "NOTE(W2): static stub — always {"status":"approved"}
 * (internal/api/v2/eliteacore/handler.go:1586-1588)") type `entityId` as a
 * `number`. The baseline addresses catalog entries with a STRING key
 * instead (`useApplicationRequests.hooks.js:26`, `entityId: app.type`, e.g.
 * `"inventory"`) — there is no numeric id for an abstract catalogue TYPE
 * (only real configured application/toolkit INSTANCES have one), so the
 * baseline's own call would not type-check against this endpoint's real
 * contract at all, independent of the stub. A stable FNV-1a hash of the
 * type key stands in: deterministic (the same type always addresses the
 * same synthetic entity across requests/reloads) and collision-safe for
 * this catalogue's 2 entries. Since the endpoint is presently a static
 * stub that ignores `entityId` entirely, this choice has no observable
 * effect today; it exists so that IF the endpoint ever becomes real, each
 * catalog type still gets its own independently-addressable moderation
 * record instead of every type silently sharing one (which a constant
 * placeholder like `0` would cause).
 */
export function entityIdForType(type: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < type.length; index += 1) {
    hash ^= type.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function statusFromResponse(response: ModerationStatusResponse | undefined): RequestStatus {
  if (response === undefined) return REQUEST_STATUS.NONE;
  const status = response.status;
  if (status === REQUEST_STATUS.PENDING || status === REQUEST_STATUS.APPROVED || status === REQUEST_STATUS.REJECTED) {
    return status;
  }
  return REQUEST_STATUS.NONE;
}

interface SubmitModerationRequestVariables {
  readonly projectId: string;
  readonly type: string;
  readonly description: string;
  readonly label: string;
}

/**
 * The generated `createModerationRequest` — the raw POST fetcher, NOT
 * `getCreateModerationRequestQueryOptions`/`useCreateModerationRequest`,
 * which orval generates query-shaped even for this POST (same class of
 * generated-shape mismatch documented at `usePinConversation.hooks.ts`'s
 * `useTogglePinConversation`) — wrapped in a locally-owned `useMutation`.
 *
 * `submitRequest` previously ran this POST through
 * `queryClient.fetchQuery(getCreateModerationRequestQueryOptions(...))`.
 * That reuses the query machinery's defaults — `retry: 1` and dedup of any
 * in-flight/cached entry sharing the options' `queryKey` within its
 * `staleTime` — against what is a non-idempotent create call: a
 * resubmission with an unchanged reason within that window could silently
 * return the cached prior response with NO new network request, and a
 * transient failure could silently auto-replay the POST once via the query
 * retry. `useMutation` has neither behaviour by default (no cache entry
 * keyed by input, `retry: 0`), so every call this hook makes through it is
 * a true one-shot POST.
 */
function useCreateModerationRequestMutation(): UseMutationResult<
  Awaited<ReturnType<typeof createModerationRequest>>,
  unknown,
  SubmitModerationRequestVariables
> {
  return useMutation({
    mutationFn: ({ projectId, type, description, label }: SubmitModerationRequestVariables) => {
      const body: IgnoredRequestBody = {
        issue_type: label,
        description,
        status: REQUEST_STATUS.PENDING,
        meta: {},
      };
      return createModerationRequest(projectId, entityIdForType(type), body);
    },
  });
}

/**
 * Replaces the baseline's `useApplicationRequests`
 * (`features/apps/lib/hooks/useApplicationRequests.hooks.js`). One
 * `useQueries` call replaces the baseline's `Promise.all` + local
 * `moderationData` state — `APPLICATION_CATALOG` is a fixed-length module
 * constant, so mapping it to one query-options object per entry is stable
 * across renders (never a variable-length hook call).
 *
 * **Practical consequence of the static-stub backend (see
 * `entityIdForType`'s doc comment above):** every status query resolves to
 * `"approved"` immediately, and `submitRequest` echoes the same
 * `"approved"` status back. `getRequestStatus` therefore never actually
 * returns `REQUEST_STATUS.PENDING` against the current Go stack — a
 * consequence of the documented backend stub, not a defect in this port's
 * client-side logic, which mirrors the baseline's state machine exactly.
 */
export function useModerationRequests() {
  const projectId = useSelectedProjectId();
  const queryClient = useQueryClient();
  const [submittingType, setSubmittingType] = useState<string | null>(null);
  const { mutateAsync: createModerationRequestAsync } = useCreateModerationRequestMutation();

  const statusQueries = useQueries({
    queries: APPLICATION_CATALOG.map((entry) =>
      getModerationStatusQueryOptions(projectId ?? '', entityIdForType(entry.type), {
        query: { enabled: projectId !== undefined },
      }),
    ),
  });

  const statusByType = useMemo(() => {
    const map = new Map<string, RequestStatus>();
    APPLICATION_CATALOG.forEach((entry, index) => {
      // `.data.data`'s declared type includes the error-envelope variant —
      // never actually reachable here since `eliteaFetch` throws instead of
      // resolving with it (mutator.ts's §3.6 unwrap contract).
      const response = statusQueries[index]?.data?.data as ModerationStatusResponse | undefined;
      map.set(entry.type, statusFromResponse(response));
    });
    return map;
  }, [statusQueries]);

  const getRequestStatus = useCallback(
    (type: string): RequestStatus => statusByType.get(type) ?? REQUEST_STATUS.NONE,
    [statusByType],
  );

  const submitRequest = useCallback(
    async (type: string, description: string, label?: string): Promise<void> => {
      if (projectId === undefined) return;
      setSubmittingType(type);
      try {
        await createModerationRequestAsync({
          projectId,
          type,
          description,
          label: label ?? 'Application Access Request',
        });
        await queryClient.invalidateQueries({
          queryKey: getModerationStatusQueryOptions(projectId, entityIdForType(type)).queryKey,
        });
      } finally {
        setSubmittingType(null);
      }
    },
    [projectId, queryClient, createModerationRequestAsync],
  );

  return {
    getRequestStatus,
    submitRequest,
    isSubmitting: submittingType !== null,
    isFetching: statusQueries.some((query) => query.isFetching),
  };
}
