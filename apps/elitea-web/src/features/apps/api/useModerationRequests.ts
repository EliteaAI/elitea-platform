import { useCallback, useMemo, useState } from 'react';

import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';

import {
  createModerationRequest,
  getModerationStatusQueryOptions,
} from '@/shared/api/generated/admin/admin';
import type { IgnoredRequestBody } from '@/shared/api/generated/model';

import { APPLICATION_CATALOG, REQUEST_STATUS } from '../lib/constants';
import type { RequestStatus } from '../lib/constants';

import { useSelectedProjectId } from './useSelectedProjectId';

/**
 * The Go admin-moderation endpoints (`/admin/moderation_status/default/
 * {project_id}/{entity_id}`, both GET and POST) type `entityId` as a
 * `number` in the generated client. The baseline addresses catalog entries
 * with a STRING key instead (`useApplicationRequests.hooks.js:26`,
 * `entityId: app.type`, e.g. `"inventory"`) — there is no numeric id for an
 * abstract catalogue TYPE (only real configured application/toolkit
 * INSTANCES have one), so the baseline's own call would not type-check
 * against this endpoint's declared contract at all. A stable FNV-1a hash of
 * the type key stands in: deterministic (the same type always addresses the
 * same synthetic entity across requests/reloads) and collision-safe for
 * this catalogue's 2 entries.
 *
 * As of unit A14 the endpoint is real: `entity_id` is a `VARCHAR` column and
 * the server stores whatever this sends, so each catalogue type does now get
 * its own independently-addressable record — which is what this hash was
 * written for. It also means the value is what an operator SEES in the admin
 * App Requests queue, where a number is less legible than `"inventory"` would
 * be. That page therefore renders `issue_type` (the human label this hook
 * sends alongside) as its Application column, with the key beneath it. The
 * remaining cost is that this app and the legacy EliteaUI address the same
 * catalogue entry by two different keys, so a request filed in one is not
 * visible to the other; fixing that means changing the generated contract's
 * `entityId` type, which is a `v2.yaml` + orval change and is NOT done here.
 */
export function entityIdForType(type: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < type.length; index += 1) {
    hash ^= type.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function asRequestStatus(status: unknown): RequestStatus | undefined {
  return status === REQUEST_STATUS.PENDING ||
    status === REQUEST_STATUS.APPROVED ||
    status === REQUEST_STATUS.REJECTED
    ? status
    : undefined;
}

/**
 * The status of the caller's most recent request for this entity, or `NONE`.
 *
 * Both shapes are read on purpose. The endpoint's REAL contract — pylon's, and
 * the Go handler's since unit A14 — is a `{total, rows}` envelope of the
 * caller's own rows, newest first. Until A14 the Go side answered a bare
 * `{"status":"approved"}` from a static stub, which is the only shape the
 * generated `ModerationStatusResponse` describes and the only one this function
 * used to read: against a real server it found no `status` field, fell through
 * to `NONE`, and the "Pending approval" state on a catalogue card was
 * unreachable — the card would keep offering "Request Access" after the request
 * had been filed.
 *
 * The bare-object branch stays because a hybrid deployment can still be served
 * by a pylon that returns the create response's shape from the POST path this
 * hook optimistically reads back.
 */
function statusFromResponse(response: unknown): RequestStatus {
  if (typeof response !== 'object' || response === null) return REQUEST_STATUS.NONE;
  const rows = (response as { rows?: unknown }).rows;
  if (Array.isArray(rows)) {
    const first: unknown = rows[0];
    if (typeof first !== 'object' || first === null) return REQUEST_STATUS.NONE;
    return asRequestStatus((first as { status?: unknown }).status) ?? REQUEST_STATUS.NONE;
  }
  return asRequestStatus((response as { status?: unknown }).status) ?? REQUEST_STATUS.NONE;
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
 * Until unit A14 the Go endpoints behind this hook were a static stub: every
 * status query resolved to `"approved"` immediately and the POST created
 * nothing, so `getRequestStatus` could never return `PENDING` and the button
 * wrote nowhere. Both are real now
 * (`services/elitea-main/internal/api/v2/moderation/requests.go`), which is
 * what `statusFromResponse` above had to be corrected for.
 *
 * The POST body still carries `status: 'pending'` and `meta: {}`. Neither is
 * applied — the server takes the status from nowhere but its own rule and
 * refuses any other value, and refuses a non-empty `meta` — but an empty
 * `meta` and an explicitly-pending status are tolerated precisely so the two
 * shipped clients keep working, so they are left as they are rather than
 * removed on one of the two.
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
      // resolving with it (mutator.ts's §3.6 unwrap contract). It is passed as
      // `unknown` rather than cast to the generated `ModerationStatusResponse`,
      // because that type describes the retired static stub's shape and not what
      // the endpoint now returns; `statusFromResponse` reads both.
      map.set(entry.type, statusFromResponse(statusQueries[index]?.data?.data));
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
