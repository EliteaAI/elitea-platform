// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';

import { ChatParticipantType, PUBLIC_PROJECT_ID } from '../../model/constants';

import { useSelectedProjectId } from '../../api/useSelectedProjectId';
import { useFetchParticipantDetails } from './useFetchParticipantDetails';

// ---------------------------------------------------------------------------
// FetchOptions — shared across the detail layer
// ---------------------------------------------------------------------------

interface FetchOptions {
  forceRefetch?: boolean;
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
 *
 * Delegates all network fetching to `useFetchParticipantDetails`, which
 * implements the full data-fetching logic:
 * - Applications/pipelines: generated `useGetApplication`/`useGetPublicApplication`
 * - Version details: generated `useGetApplicationVersionDetail`
 * - Toolkits: client-side list lookup (no GET-single endpoint exists)
 */
export function useActiveParticipantDetails(
  props: { activeParticipant?: Record<string, unknown> | null; skip?: boolean },
): UseActiveParticipantDetailsResult {
  const { activeParticipant, skip } = props;
  const projectId = useSelectedProjectId();
  const { fetchOriginalDetails, fetchOriginalVersionDetails } = useFetchParticipantDetails();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeParticipant id + project + name + version_id drive re-fetch
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
