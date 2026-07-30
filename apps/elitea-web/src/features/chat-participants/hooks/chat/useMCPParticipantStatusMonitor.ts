// @ts-nocheck
/**
 * MCP participant status monitor — ported from `useMCPParticipantStatusMonitor.js`.
 * Listens for `mcp_status` socket events to track MCP connection status.
 */
import { useCallback, useEffect } from 'react';

import { SOCKET_EVENT_NAMES } from '@/shared/api/socket/events';

/**
 * Monitors MCP participant connection status via WebSocket events.
 * Ported from `useMCPParticipantStatusMonitor.js`.
 */
export function useMCPParticipantStatusMonitor({
  projectId,
  mcpType,
  isMCP,
  onMCPConnectionStatusChange,
}: {
  projectId?: string;
  mcpType?: string;
  isMCP?: boolean;
  onMCPConnectionStatusChange?: (connected: boolean) => void;
}) {
  // NOTE: Socket integration is complex — the old app used a `useSocket` hook
  // that listens for `sioEvents.mcp_status`. In the new app, the socket event
  // name is `SOCKET_EVENT_NAMES.mcp_status` (confirmed present in events.ts:620-626).
  // A full port would require the new app's socket connection abstraction.
  // For now, this is a placeholder that discards.

  const handleMCPStatusEvent = useCallback(
    (message: Record<string, unknown>) => {
      if (!isMCP) return;

      const { project_id, connected, type } = message;
      if (type === mcpType && projectId == project_id) {
        onMCPConnectionStatusChange?.(connected);
      }
    },
    [isMCP, mcpType, onMCPConnectionStatusChange, projectId],
  );

  // Socket event listener would go here in a full port
  useEffect(() => {
    // Real impl: useSocket(SOCKET_EVENT_NAMES.mcp_status, handleMCPStatusEvent);
    return () => {};
  }, [handleMCPStatusEvent]);

  return {};
}

export default function useMCPParticipantStatusMonitorHook(props: Parameters<typeof useMCPParticipantStatusMonitor>[0]) {
  return useMCPParticipantStatusMonitor(props);
}
