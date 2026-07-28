import type { ReactNode } from 'react';

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

import { useAgentMCPToolsStatusMonitor } from './useAgentMCPToolsStatusMonitor';

function withSocket(client: TestSocketClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SocketClientContext.Provider value={client}>{children}</SocketClientContext.Provider>;
  };
}

const MCP_TOOL = { type: 'mcp', meta: { mcp: true } };
const REGULAR_TOOL = { type: 'github' };

describe('useAgentMCPToolsStatusMonitor', () => {
  it('applies an mcp_status event to the matching tool when the version has an MCP tool', () => {
    const client = createTestSocketClient();
    const onToolsChange = vi.fn();
    renderHook(
      () => useAgentMCPToolsStatusMonitor({ tools: [REGULAR_TOOL, MCP_TOOL], projectId: 'proj-1', onToolsChange }),
      { wrapper: withSocket(client) },
    );

    client.simulateServerEvent('mcp_status', { type: 'mcp', connected: true, project_id: 'proj-1' });

    expect(onToolsChange).toHaveBeenCalledTimes(1);
    expect(onToolsChange).toHaveBeenCalledWith([REGULAR_TOOL, { ...MCP_TOOL, online: true }]);
  });

  it('does nothing when the version has no MCP-flavoured tool (isMCP short-circuit)', () => {
    const client = createTestSocketClient();
    const onToolsChange = vi.fn();
    renderHook(() => useAgentMCPToolsStatusMonitor({ tools: [REGULAR_TOOL], projectId: 'proj-1', onToolsChange }), {
      wrapper: withSocket(client),
    });

    client.simulateServerEvent('mcp_status', { type: 'github', connected: true, project_id: 'proj-1' });

    expect(onToolsChange).not.toHaveBeenCalled();
  });

  it('ignores an event for a different project', () => {
    const client = createTestSocketClient();
    const onToolsChange = vi.fn();
    renderHook(
      () => useAgentMCPToolsStatusMonitor({ tools: [MCP_TOOL], projectId: 'proj-1', onToolsChange }),
      { wrapper: withSocket(client) },
    );

    client.simulateServerEvent('mcp_status', { type: 'mcp', connected: true, project_id: 'proj-999' });

    expect(onToolsChange).not.toHaveBeenCalled();
  });

  it('applies the event when projectId is undefined (no gating possible yet)', () => {
    const client = createTestSocketClient();
    const onToolsChange = vi.fn();
    renderHook(
      () => useAgentMCPToolsStatusMonitor({ tools: [MCP_TOOL], projectId: undefined, onToolsChange }),
      { wrapper: withSocket(client) },
    );

    client.simulateServerEvent('mcp_status', { type: 'mcp', connected: false, project_id: 'proj-1' });

    expect(onToolsChange).toHaveBeenCalledWith([{ ...MCP_TOOL, online: false }]);
  });

  it('unsubscribes on unmount', () => {
    const client = createTestSocketClient();
    const onToolsChange = vi.fn();
    const { unmount } = renderHook(
      () => useAgentMCPToolsStatusMonitor({ tools: [MCP_TOOL], projectId: 'proj-1', onToolsChange }),
      { wrapper: withSocket(client) },
    );

    unmount();
    client.simulateServerEvent('mcp_status', { type: 'mcp', connected: true, project_id: 'proj-1' });

    expect(onToolsChange).not.toHaveBeenCalled();
  });
});
