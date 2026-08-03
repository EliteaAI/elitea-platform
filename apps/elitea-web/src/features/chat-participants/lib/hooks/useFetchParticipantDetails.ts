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

/** Page size for the toolkit detail lookup's list-scan fallback (see `fetchToolkit`). */
const TOOLKIT_LOOKUP_PAGE_SIZE = 200;

/**
 * Hard cap on pages scanned by `fetchToolkit`'s fallback (5,000 toolkit
 * instances). Old-app used a dedicated single-toolkit GET
 * (`GET /tool/prompt_lib/{projectId}/{toolkitId}`, `api/toolkits.js:122-124`)
 * with no such ceiling; no equivalent single-entity endpoint exists in this
 * app's generated client (only the paginated list, `/tools/prompt_lib/
 * {projectId}`) — a real, disclosed backend/client-coverage gap, not
 * something this port can close. This bound only protects against runaway
 * sequential fetches for a pathologically large project; a toolkit ranked
 * beyond it is still unreachable, same class of gap as the single-page cap
 * this replaces, just far less likely to bite in practice.
 */
const MAX_TOOLKIT_LOOKUP_PAGES = 25;

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

async function fetchToolkitPage(id: string, projectId: string, offset: number): Promise<{ toolkit?: Record<string, unknown>; rowCount: number }> {
  const search = new URLSearchParams();
  search.set('limit', String(TOOLKIT_LOOKUP_PAGE_SIZE));
  search.set('offset', String(offset));
  const url = `/elitea_core/tools/prompt_lib/${projectId}?${search.toString()}`;
  const envelope = await eliteaFetch<{ data: { rows: Record<string, unknown>[]; total: number } }>(url);
  const rows = envelope?.data?.rows || [];
  return { toolkit: rows.find((row) => String(row.id) === id), rowCount: rows.length };
}

/**
 * Scans `/elitea_core/tools/prompt_lib/{projectId}` page by page for the
 * toolkit instance with the given `id`, stopping at the first short page
 * (fewer rows than the page size — the real last page) or
 * `MAX_TOOLKIT_LOOKUP_PAGES`, whichever comes first. See the constants above
 * for why this is a scan, not a single-entity GET.
 */
async function fetchToolkit(
  id: string,
  projectId: string,
): Promise<Record<string, unknown>> {
  for (let page = 0; page < MAX_TOOLKIT_LOOKUP_PAGES; page += 1) {
    const { toolkit, rowCount } = await fetchToolkitPage(id, projectId, page * TOOLKIT_LOOKUP_PAGE_SIZE);
    if (toolkit) return toolkit;
    if (rowCount < TOOLKIT_LOOKUP_PAGE_SIZE) break;
  }
  return {};
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
