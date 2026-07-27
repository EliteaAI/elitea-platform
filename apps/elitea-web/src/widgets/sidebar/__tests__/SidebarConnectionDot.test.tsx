import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SocketClientContext, type SocketClient } from '@/shared/api/socket/client';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { SidebarConnectionDot } from '../ui/SidebarConnectionDot';

/** Minimal fake satisfying `SocketClient` — only `useConnectionState` is exercised by this component. */
function fakeClient(status: 'connected' | 'disconnected'): SocketClient {
  return {
    socket: {} as SocketClient['socket'],
    getConnectionState: () => status,
    useConnectionState: () => status,
    emit: () => true,
    on: () => {},
    off: () => {},
    disconnect: () => {},
  };
}

describe('SidebarConnectionDot (SHELL-012)', () => {
  it('renders nothing when no SocketClientContext.Provider is mounted (graceful degradation)', () => {
    const { container } = renderWithTheme(<SidebarConnectionDot />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a "Connected" dot when the socket is connected', () => {
    renderWithTheme(
      <SocketClientContext.Provider value={fakeClient('connected')}>
        <SidebarConnectionDot />
      </SocketClientContext.Provider>,
    );
    expect(screen.getByTestId('sidebar-connection-dot')).toBeInTheDocument();
    expect(screen.getByLabelText('Connected')).toBeInTheDocument();
  });

  it('shows a "Disconnected" dot when the socket is not connected', () => {
    renderWithTheme(
      <SocketClientContext.Provider value={fakeClient('disconnected')}>
        <SidebarConnectionDot />
      </SocketClientContext.Provider>,
    );
    expect(screen.getByTestId('sidebar-connection-dot')).toBeInTheDocument();
    expect(screen.getByLabelText('Disconnected')).toBeInTheDocument();
  });
});
