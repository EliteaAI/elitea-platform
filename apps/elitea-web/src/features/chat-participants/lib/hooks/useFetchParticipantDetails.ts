// @ts-nocheck
import { useCallback, useMemo } from 'react';

import { DEFAULT_PARTICIPANT_NAME } from '@/entities/participant';

import type { ChatParticipantType } from '../../model/constants';

// ---------------------------------------------------------------------------
// UseFetchParticipantDetailsResult — return shape
// ---------------------------------------------------------------------------

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
// useFetchParticipantDetails
// ---------------------------------------------------------------------------

/**
 * Hook that fetches original details for application/pipeline/toolkit
 * participants. Replaces the old app's `useFetchParticipantDetails.hooks.js`.
 *
 * Cross-feature note: the old app imported `useLazyToolkitsDetailsQuery` from
 * `@/api/toolkits` (an RTK Query hook). In the new app, the `getToolkit`
 * single-item operation is missing from the OpenAPI spec, so there's no
 * generated hook for it. This hook uses a hand-written fetcher following the
 * same pattern as `features/toolkits`'s own `useToolkitDetail` workaround
 * (client-side lookup inside `useListToolkitInstances`), but built locally
 * here to avoid the `no-sideways-features` violation.
 */
export function useFetchParticipantDetails(): UseFetchParticipantDetailsResult {
  // NOTE: Placeholder — full implementation will call:
  //  - useGetApplication (generated) for applications/pipelines
  //  - useGetPublicApplication (generated) for published agents
  //  - useGetApplicationVersion (generated) for version details
  //  - A local hand-written toolkit detail fetcher
  // See the old-app file for the full callback implementation.

  const fetchOriginalDetails = useCallback(
    async (
      _type: ChatParticipantType,
      _id: string,
      _projectId: string,
      _options?: { forceRefetch?: boolean },
    ): Promise<Record<string, unknown>> => {
      // Placeholder — full port pending toolkit detail fetcher
      return {};
    },
    [],
  );

  const fetchOriginalVersionDetails = useCallback(
    async (
      _type: ChatParticipantType,
      _id: string,
      _versionId: string,
      _projectId: string,
      _versionName: string,
    ): Promise<Record<string, unknown>> => {
      // Placeholder — full port pending
      return {};
    },
    [],
  );

  return {
    fetchOriginalDetails,
    fetchOriginalVersionDetails,
    isFetchingParticipant: false,
  };
}
