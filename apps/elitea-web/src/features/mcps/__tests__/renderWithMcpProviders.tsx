/**
 * Shared render helper for this slice's component tests — every UI
 * component reads `theme.vars.palette.*` (R-T7, same reason `shared/ui`'s
 * `testTheme.tsx` exists) AND several also call `useSocketClient()`
 * (`McpLogInButton`/`McpLogInLink`/`McpAuthStatusBadge`/`useMcpLogin`'s
 * `useMcpAuthCheck` dependency), so both providers are wrapped once here
 * instead of duplicated per test file.
 */
import type { ReactElement, ReactNode } from 'react';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { render, type RenderResult } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

/**
 * Safely reads the `stream_id` an emitted `test_mcp_connection` payload
 * carries — avoids `no-unsafe-optional-chaining` (`payload?.stream_id`
 * would silently evaluate to `undefined` mid-expression rather than
 * failing loudly) by asserting the emission actually happened first, with
 * a message that names what was expected.
 */
export function emittedStreamId(client: TestSocketClient, event: 'test_mcp_connection' = 'test_mcp_connection'): string {
  const emitted = client.getEmitted(event);
  const first = emitted[0];
  if (!first) throw new Error(`test setup: expected at least one "${event}" emission, got none`);
  const { payload } = first;
  if (typeof payload !== 'object' || payload === null || !('stream_id' in payload) || typeof payload.stream_id !== 'string') {
    throw new Error(`test setup: "${event}" emission had no string stream_id (got ${JSON.stringify(payload)})`);
  }
  return payload.stream_id;
}

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

export interface RenderWithMcpProvidersResult extends RenderResult {
  socket: TestSocketClient;
}

export function renderWithMcpProviders(ui: ReactElement, socket: TestSocketClient = createTestSocketClient()): RenderWithMcpProvidersResult {
  const wrap = (node: ReactNode): ReactElement => (
    <ThemeProvider
      theme={theme}
      defaultMode={DEFAULT_COLOR_SCHEME}
    >
      <CssBaseline />
      <SocketClientContext.Provider value={socket}>{node}</SocketClientContext.Provider>
    </ThemeProvider>
  );

  const result = render(wrap(ui));
  return {
    ...result,
    rerender: (nextUi: ReactNode) => result.rerender(wrap(nextUi)),
    socket,
  };
}
