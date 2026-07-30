// @ts-nocheck
/**
 * MCP participant status monitor — ported from `useMCPParticipantStatusMonitor.js`.
 * Listens for `mcp_status` socket events to track MCP connection status.
 *
 * DEVIATION FROM BASELINE: `useSocket` is replaced with unit S5's typed
 * `useSocketClient()` + the socket event name literal `'mcp_status'`
 * (confirmed present in `SOCKET_EVENT_NAMES`, `shared/api/socket/events.ts:620`).
 */
import { useCallback, useEffect } from 'react';

import { useSocketClient } from '@/shared/api/socket/client';

/** Shape of the `mcp_status` socket event payload (shared/api/socket/events.ts:620). */
interface McpStatusPayload {
  project_id?: string | number;
  connected?: boolean;
  type?: string;
}

/**
 * Monitors MCP participant connection status via WebSocket events.
 * Ported from `useMCPParticipantStatusMonitor.js`.
 *
 * Subscribes to the `mcp_status` socket event and calls `onMCPConnectionStatusChange`
 * when the event matches this participant's project and type.
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
  const socket = useSocketClient();

  const handleMCPStatusEvent = useCallback(
    (message: McpStatusPayload) => {
      if (!isMCP) return;

      const { project_id, connected, type } = message;
      if (type === mcpType && projectId == String(project_id)) {
        onMCPConnectionStatusChange?.(connected ?? false);
      }
    },
    [isMCP, mcpType, onMCPConnectionStatusChange, projectId],
  );

  useEffect(() => {
    socket.on('mcp_status', handleMCPStatusEvent);
    return () => socket.off('mcp_status', handleMCPStatusEvent);
  }, [socket, handleMCPStatusEvent]);

  return {};
}

export default function useMCPParticipantStatusMonitorHook(props: Parameters<typeof useMCPParticipantStatusMonitor>[0]) {
  return useMCPParticipantStatusMonitor(props);
}
