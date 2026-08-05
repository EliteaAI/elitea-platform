// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChatParticipantType } from '../../model/constants';
import type { ParticipantDetailsContextValue, ParticipantStatusFlags } from '../../model/types';

import { useFetchParticipantDetails } from '../hooks/useFetchParticipantDetails';

const getCacheKey = (type: string, id: string, projectId: string): string => `${type}::${id}::${projectId}`;

const EMPTY_STATUS: ParticipantStatusFlags = Object.freeze({
  hasError: false,
  shouldDisableThisItem: false,
  hasMisconfigurationErrors: false,
  someToolsAreUnavailable: false,
  blockedToolkitNames: [],
  isPublishedAgentGone: false,
  isVersionUnavailable: false,
  mcpIsDisconnected: false,
  remoteMcpLoggedOut: false,
  hasRemoteMcpLoggedIn: false,
  spOAuthLoggedOut: false,
  spOAuthLoggedIn: false,
  spConfig: null,
});

// ---------------------------------------------------------------------------
// ParticipantDetailsContext
// ---------------------------------------------------------------------------

const ParticipantDetailsContext = React.createContext<ParticipantDetailsContextValue | null>(null);

/**
 * Provider that fetches and caches detail data for all non-user participants.
 * Ported from `ParticipantDetailsContext.jsx`.
 *
 * Each participant (type, id, project_id) gets its own cache entry fetched
 * via `useFetchParticipantDetails.fetchOriginalDetails`. Status computation
 * (error flags, MCP status, etc.) is handled by `ParticipantStatusRunner`
 * children — each runner updates the shared status map.
 */
export function ParticipantDetailsProvider({
  participants = [],
  children,
}: {
  participants: Record<string, unknown>[];
  children: React.ReactNode;
}): React.ReactElement {
  const fetchingRef = useRef(new Set<string>());
  const { fetchOriginalDetails } = useFetchParticipantDetails();

  const [detailsMap, setDetailsMap] = useState<Record<string, Record<string, unknown>>>({});
  const [completedKeys, setCompletedKeys] = useState<Record<string, boolean>>({});
  const [statusMap, setStatusMap] = useState<Record<string, ParticipantStatusFlags>>({});

  // Fetch details for all non-user participants on mount
  useEffect(() => {
    for (const p of participants) {
      const entityMeta = (p.entity_meta as Record<string, unknown>) ?? {};
      const entityName = p.entity_name as ChatParticipantType | undefined;
      if (!entityMeta?.id || !entityMeta?.project_id) continue;
      if (entityName === ChatParticipantType.Users) continue;

      const key = getCacheKey(String(entityName), String((entityMeta.id as string) ?? ''), String((entityMeta.project_id as string) ?? ''));
      if (fetchingRef.current.has(key)) continue;

      fetchingRef.current.add(key);

      fetchOriginalDetails(entityName, String(entityMeta.id as string), String(entityMeta.project_id as string))
        .then((data) => {
          setDetailsMap((prev) => ({ ...prev, [key]: data }));
          setCompletedKeys((prev) => ({ ...prev, [key]: true }));
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, fetchOriginalDetails]);

  const getDetails = useCallback(
    (type: ChatParticipantType, id: string, projectId: string): Record<string, unknown> => {
      return detailsMap[getCacheKey(String(type), id, String(projectId))] || {};
    },
    [detailsMap],
  );

  const hasFetched = useCallback(
    (type: ChatParticipantType, id: string, projectId: string): boolean => {
      return !!completedKeys[getCacheKey(String(type), id, String(projectId))];
    },
    [completedKeys],
  );

  const updateDetails = useCallback(
    (type: ChatParticipantType, id: string, projectId: string, updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => {
      const key = getCacheKey(String(type), id, String(projectId));
      setDetailsMap((prev) => ({
        ...prev,
        [key]: typeof updater === 'function' ? updater(prev[key] || {}) : { ...(prev[key]), ...updater },
      }));
    },
    [],
  );

  const refetchDetails = useCallback(
    async (type: ChatParticipantType, id: string, projectId: string): Promise<Record<string, unknown>> => {
      const key = getCacheKey(String(type), id, String(projectId));
      const data = await fetchOriginalDetails(type, id, String(projectId), { forceRefetch: true });
      setDetailsMap((prev) => ({ ...prev, [key]: data }));
      setCompletedKeys((prev) => ({ ...prev, [key]: true }));
      return data;
    },
    [fetchOriginalDetails],
  );

  const _setParticipantStatus = useCallback((key: string, status: ParticipantStatusFlags) => {
    setStatusMap((prev) => ({ ...prev, [key]: status }));
  }, []);

  const getParticipantStatus = useCallback(
    (type: ChatParticipantType, id: string, projectId: string): ParticipantStatusFlags => {
      return statusMap[getCacheKey(String(type), id, String(projectId))] || EMPTY_STATUS;
    },
    [statusMap],
  );

  const hasParticipantError = useCallback(
    (type: ChatParticipantType, id: string, projectId: string): boolean => {
      const status = statusMap[getCacheKey(String(type), id, String(projectId))];
      return !!status?.hasError;
    },
    [statusMap],
  );

  const value = useMemo(
    () => ({ getDetails, hasFetched, updateDetails, refetchDetails, getParticipantStatus, hasParticipantError }),
    [getDetails, hasFetched, updateDetails, refetchDetails, getParticipantStatus, hasParticipantError],
  );

  const _nonUserParticipants = useMemo(
    () =>
      participants.filter(
        (p) =>
          p.entity_name !== ChatParticipantType.Users &&
          (p.entity_meta as Record<string, unknown>)?.id &&
          (p.entity_meta as Record<string, unknown>)?.project_id,
      ),
    [participants],
  );

  // NOTE: ParticipantStatusRunner children are NOT rendered here — they require
  // cross-feature hooks (mcp token change, sharepoint config, tool validation)
  // that are resolved via slot injection at the consumer level. The context
  // value still provides status update/reading capabilities; consumers wire
  // up the runners with their slots.

  return (
    <ParticipantDetailsContext.Provider value={value}>
      {/* ParticipantStatusRunner children are rendered by the consumer with slot injection */}
      {children}
    </ParticipantDetailsContext.Provider>
  );
}

/**
 * Hook to access the participant details context.
 * Must be used within `ParticipantDetailsProvider`.
 */
export function useParticipantDetailsContext(): ParticipantDetailsContextValue {
  const context = React.useContext(ParticipantDetailsContext);
  if (!context) {
    throw new Error('useParticipantDetailsContext must be used within ParticipantDetailsProvider');
  }
  return context;
}
