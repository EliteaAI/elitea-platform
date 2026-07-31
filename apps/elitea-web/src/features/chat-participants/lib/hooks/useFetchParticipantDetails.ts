// @ts-nocheck
import { useCallback } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import {
  getGetApplicationQueryOptions,
  getGetPublicApplicationQueryOptions,
  getGetApplicationVersionDetailQueryOptions,
} from '@/shared/api/generated/applications/applications';

import { ChatParticipantType, PUBLIC_PROJECT_ID } from '../../model/constants';

// ---------------------------------------------------------------------------
// UseFetchParticipantDetailsResult — return shape (inlined to avoid
// self-import circular dependency flagged by depcruise)
// ---------------------------------------------------------------------------

/** Type-level assertion that a value is never (i.e. all enum cases handled). */
function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unhandled type: ${String(value)}`);
}

export interface UseFetchParticipantDetailsResult {
  fetchOriginalDetails: (
    type: ChatParticipantType,
    id: string,
    projectId: string,
    options?: { forceRefetch?: boolean },
  ) => Promise<Record<string, unknown>>;
  fetchOriginalVersionDetails: (
    type: ChatParticipantType,
    id: string,
    versionId: string,
    projectId: string,
    versionName: string,
  ) => Promise<Record<string, unknown>>;
  isFetchingParticipant: boolean;
}

// ---------------------------------------------------------------------------
// useFetchParticipantDetails — full implementation
// ---------------------------------------------------------------------------

/** Maximum toolkit instances to fetch in a single page for the detail lookup. */
const MAX_TOOLKIT_LOOKUP_PAGE_SIZE = 200;

/**
 * Fetches original details for a participant from the backend.
 * Ported from `useFetchParticipantDetails.hooks.js`.
 *
 * Cross-feature note: the single-toolkit-detail GET has no OpenAPI endpoint.
 * This hook fetches the toolkit list and finds the matching row client-side
 * — the same pattern `features/toolkits/api/toolkits.ts`'s `useToolkitDetail`
 * uses (A4g).
 */
export function useFetchParticipantDetails(): UseFetchParticipantDetailsResult {
  const queryClient = useQueryClient();

  const fetchOriginalDetails = useCallback(
    async (
      type: ChatParticipantType,
      id: string,
      projectId: string,
      options?: { forceRefetch?: boolean },
    ): Promise<Record<string, unknown>> => {
      const fetchOptions = options?.forceRefetch ? { staleTime: 0 } : undefined;

      switch (type) {
        case ChatParticipantType.Pipelines:
        case ChatParticipantType.Applications: {
          const getAppOptions =
            projectId !== PUBLIC_PROJECT_ID
              ? getGetApplicationQueryOptions(projectId, Number(id), undefined, undefined, fetchOptions)
              : getGetPublicApplicationQueryOptions(String(id), undefined, undefined, fetchOptions);
          const result = await queryClient.fetchQuery(getAppOptions);
          return (result?.data as Record<string, unknown>) || {};
        }

        case ChatParticipantType.Toolkits: {
          // No GET-single endpoint exists. Fetch the toolkit list and find
          // the matching row client-side (same pattern as
          // features/toolkits/api/toolkits.ts's useToolkitDetail).
          const search = new URLSearchParams();
          search.set('limit', String(MAX_TOOLKIT_LOOKUP_PAGE_SIZE));
          search.set('offset', '0');
          const url = `/elitea_core/tools/prompt_lib/${projectId}?${search.toString()}`;
          const envelope = await eliteaFetch<{ data: { rows: Record<string, unknown>[]; total: number } }>(url);
          const rows = envelope?.data?.rows || [];
          const toolkit = rows.find((row) => String(row.id) === id) || {};
          return toolkit as Record<string, unknown>;
        }

        // Cases below are enum values that exist but are not valid chat participants.
        // They are included only to satisfy the switch-exhaustiveness checker;
        // assertNever will throw if any reach this point at runtime.
        case ChatParticipantType.Attachments:
        case ChatParticipantType.Dummy:
        case ChatParticipantType.MCP:
        case ChatParticipantType.Models:
        case ChatParticipantType.Tools:
        case ChatParticipantType.Users:
          return assertNever(type);
      }
    },
    [queryClient],
  );

  const fetchOriginalVersionDetails = useCallback(
    async (
      type: ChatParticipantType,
      id: string,
      versionId: string,
      projectId: string,
      versionName: string,
    ): Promise<Record<string, unknown>> => {
      if (!versionId) return {};

      switch (type) {
        case ChatParticipantType.Pipelines:
        case ChatParticipantType.Applications: {
          if (projectId === PUBLIC_PROJECT_ID) {
            // Published agents: use public_application with version name
            const result = await queryClient.fetchQuery(
              getGetPublicApplicationQueryOptions(id, versionName, undefined, { staleTime: 0 }),
            );
            return ((result?.data as Record<string, unknown>)?.version_details as Record<string, unknown>) || {};
          }

          // Private: use application version detail
          const result = await queryClient.fetchQuery(
            getGetApplicationVersionDetailQueryOptions(
              projectId,
              Number(id),
              Number(versionId),
              undefined,
              { staleTime: 0 },
            ),
          );
          return (result?.data as Record<string, unknown>) || {};
        }

        // Cases below are enum values that exist but are not valid for version details lookups.
        // Included only to satisfy the switch-exhaustiveness checker.
        case ChatParticipantType.Attachments:
        case ChatParticipantType.Dummy:
        case ChatParticipantType.MCP:
        case ChatParticipantType.Models:
        case ChatParticipantType.Toolkits:
        case ChatParticipantType.Tools:
        case ChatParticipantType.Users:
          return assertNever(type);
      }
    },
    [queryClient],
  );

  return {
    fetchOriginalDetails,
    fetchOriginalVersionDetails,
    isFetchingParticipant: false,
  };
}
