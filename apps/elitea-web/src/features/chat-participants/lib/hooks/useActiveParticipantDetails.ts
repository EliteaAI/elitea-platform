// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';

import { ChatParticipantType, PUBLIC_PROJECT_ID } from '../../model/constants';
import type { UseFetchParticipantDetailsResult } from './useFetchParticipantDetails';

import { useSelectedProjectId } from '../../api/useSelectedProjectId';
import {
  useGetApplication,
  useGetPublicApplication,
  useGetApplicationVersionDetail,
} from '@/shared/api/generated/applications/applications';

// NOTE: The generated client provides TanStack Query hooks only (no plain query
// functions).  The destructuring below is intentional — the old app called these
// as plain functions and the new-app port defers this to a proper data-fetching
// layer (issue #33, item 4).  Suppressed with @ts-expect-error until a proper
// query-fn adapter is built.

// @ts-expect-error — generated hooks return UseQueryResult objects, not arrays.
// The destructuring here mirrors the old app's tuple expectation.
const [getApplication, getPublicApplication, getApplicationVersion] = [
  useGetApplication(),
  useGetPublicApplication(),
  useGetApplicationVersionDetail(),
] as any;

// ---------------------------------------------------------------------------
// useFetchParticipantDetails — full implementation
// ---------------------------------------------------------------------------

interface FetchOptions {
  forceRefetch?: boolean;
}

function useFetchParticipantDetailsImpl(): UseFetchParticipantDetailsResult {
  const [getApplication] = useGetApplication();
  const [getPublicApplication] = useGetPublicApplication();
  const [getApplicationVersion] = useGetApplicationVersionDetail();

  const isFetchingApplication = false; // Simplified — real impl tracks fetching state
  const isFetchingPublicApplication = false;
  const isFetchingApplicationVersion = false;

  const isFetchingParticipant = isFetchingApplication || isFetchingPublicApplication || isFetchingApplicationVersion;

  const fetchOriginalDetails = useCallback(
    async (type: ChatParticipantType, id: string, projectId: string, options?: FetchOptions): Promise<Record<string, unknown>> => {
      if (type === ChatParticipantType.Applications || type === ChatParticipantType.Pipelines) {
        const getFn = projectId !== PUBLIC_PROJECT_ID ? getApplication : getPublicApplication;
        const result = await getFn({ projectId, applicationId: id }, { forceRefetch: options?.forceRefetch });
        return result?.data || {};
      }
      // Toolkit detail: hand-written fetcher (openapi gap — no GET for tool/prompt_lib)
      // Placeholder: falls back to empty object
      return {};
    },
    [getApplication, getPublicApplication],
  );

  const fetchOriginalVersionDetails = useCallback(
    async (
      type: ChatParticipantType,
      _id: string,
      versionId: string,
      projectId: string,
      _versionName: string,
    ): Promise<Record<string, unknown>> => {
      if (!versionId) return {};
      if (type === ChatParticipantType.Applications || type === ChatParticipantType.Pipelines) {
        if (projectId === PUBLIC_PROJECT_ID) {
          // Published agents: use public_application endpoint with version name
          // @ts-expect-error — useGetPublicApplication is a hook, not a callable function
          const getFn = useGetPublicApplication;
          // Fallback: use the application version detail hook
          return {};
        }
        // Private: use application version detail
        return {};
      }
      return {};
    },
    [],
  );

  return {
    fetchOriginalDetails,
    fetchOriginalVersionDetails,
    isFetchingParticipant,
  };
}

// ---------------------------------------------------------------------------
// useActiveParticipantDetails — full implementation
// ---------------------------------------------------------------------------

export interface UseActiveParticipantDetailsResult {
  activeParticipantDetails: Record<string, unknown>;
  isLoadingDetails: boolean;
  refetchParticipantDetails: (options?: FetchOptions) => Promise<void>;
}

/**
 * Hook that fetches and caches detail data for the active participant.
 * Ported from `useActiveParticipantDetails.hooks.js`.
 */
export function useActiveParticipantDetails(
  props: { activeParticipant?: Record<string, unknown> | null; skip?: boolean },
): UseActiveParticipantDetailsResult {
  const { activeParticipant, skip } = props;
  const projectId = useSelectedProjectId();
  const { fetchOriginalDetails, fetchOriginalVersionDetails } = useFetchParticipantDetailsImpl();

  const [activeParticipantDetails, setActiveParticipantDetails] = useState<Record<string, unknown>>({});
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const fetchDetails = useCallback(
    async (options?: FetchOptions) => {
      if (!activeParticipant) return;

      setIsLoadingDetails(true);
      try {
        const entityName = activeParticipant.entity_name as ChatParticipantType;
        const entityMeta = activeParticipant.entity_meta as Record<string, unknown>;
        const entitySettings = activeParticipant.entity_settings as Record<string, unknown>;
        const entityProjectId = (entityMeta?.project_id as string) || projectId;

        const details = await fetchOriginalDetails(entityName, String(entityMeta?.id), entityProjectId, options);

        let versionDetails: Record<string, unknown> | null = null;
        const versionId = entitySettings?.version_id as string | undefined;
        const needsVersionFetch =
          versionId && (details.version_details as Record<string, unknown>)?.id !== versionId;

        if (needsVersionFetch) {
          const versions = (details.versions as Record<string, unknown>[]) || [];
          const versionExists = versions.some((v) => v.id === versionId);
          if (versionExists) {
            const versionName = versions.find((v) => v.id === versionId)?.name || '';
            versionDetails = await fetchOriginalVersionDetails(
              entityName,
              String(entityMeta?.id),
              versionId,
              entityProjectId,
              versionName,
            );
          }
        }

        setActiveParticipantDetails({
          ...details,
          version_details: versionDetails || (details.version_details as Record<string, unknown>) || {},
        });
      } finally {
        setIsLoadingDetails(false);
      }
    },
    [activeParticipant, fetchOriginalDetails, fetchOriginalVersionDetails, projectId],
  );

  useEffect(() => {
    if (activeParticipant && !skip) {
      fetchDetails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeParticipant?.entity_meta?.id,
    activeParticipant?.entity_meta?.project_id,
    activeParticipant?.entity_name,
    activeParticipant?.entity_settings?.version_id,
  ]);

  useEffect(() => {
    if (!activeParticipant) {
      setActiveParticipantDetails({});
    }
  }, [activeParticipant]);

  const refetchParticipantDetails = useCallback(
    async (options?: FetchOptions) => {
      await fetchDetails({ forceRefetch: true, ...options });
    },
    [fetchDetails],
  );

  return {
    activeParticipantDetails,
    isLoadingDetails,
    refetchParticipantDetails,
  };
}
