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
// UseFetchParticipantDetailsResult — return shape
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
// Constants
// ---------------------------------------------------------------------------

/** Maximum toolkit instances to fetch in a single page for the detail lookup. */
const MAX_TOOLKIT_LOOKUP_PAGE_SIZE = 200;

// ---------------------------------------------------------------------------
// Fetch helpers (complexity ≤ 7 per function)
// ---------------------------------------------------------------------------

async function fetchApplicationOrPipeline(
  queryClient: unknown,
  id: string,
  projectId: string,
  options: { staleTime?: number } | undefined,
): Promise<Record<string, unknown>> {
  if (projectId !== PUBLIC_PROJECT_ID) {
    const opts = getGetApplicationQueryOptions(projectId, Number(id), undefined, undefined, options);
    const result = await queryClient.fetchQuery(opts);
    return result?.data || {};
  }
  const opts = getGetPublicApplicationQueryOptions(String(id), undefined, undefined, options);
  const result = await queryClient.fetchQuery(opts);
  return result?.data || {};
}

async function fetchVersionDetails(
  queryClient: unknown,
  id: string,
  versionId: string,
  projectId: string,
  versionName: string,
): Promise<Record<string, unknown>> {
  if (projectId === PUBLIC_PROJECT_ID) {
    const result = await queryClient.fetchQuery(
      getGetPublicApplicationQueryOptions(id, versionName, undefined, { staleTime: 0 }),
    );
    return ((result?.data as Record<string, unknown>)?.version_details as Record<string, unknown>) || {};
  }
  const result = await queryClient.fetchQuery(
    getGetApplicationVersionDetailQueryOptions(
      projectId,
      Number(id),
      Number(versionId),
      undefined,
      { staleTime: 0 },
    ),
  );
  return result?.data || {};
}

async function fetchToolkit(
  id: string,
  projectId: string,
): Promise<Record<string, unknown>> {
  const search = new URLSearchParams();
  search.set('limit', String(MAX_TOOLKIT_LOOKUP_PAGE_SIZE));
  search.set('offset', '0');
  const url = `/elitea_core/tools/prompt_lib/${projectId}?${search.toString()}`;
  const envelope = await eliteaFetch<{ data: { rows: Record<string, unknown>[]; total: number } }>(url);
  const rows = envelope?.data?.rows || [];
  const toolkit = rows.find((row) => String(row.id) === id) || {};
  return toolkit;
}

// ---------------------------------------------------------------------------
// useFetchParticipantDetails
// ---------------------------------------------------------------------------

/**
 * Fetches original details for a participant from the backend.
 * Ported from `useFetchParticipantDetails.hooks.js`.
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
      switch (type) {
        case ChatParticipantType.Pipelines:
        case ChatParticipantType.Applications:
          return fetchApplicationOrPipeline(queryClient, id, projectId, options?.forceRefetch ? { staleTime: 0 } : undefined);
        case ChatParticipantType.Toolkits:
          return fetchToolkit(id, projectId);
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
        case ChatParticipantType.Applications:
          return fetchVersionDetails(queryClient, id, versionId, projectId, versionName);
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
