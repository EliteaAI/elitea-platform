import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getListToolkitsMockHandler } from '@/shared/api/generated/toolkits/toolkits.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useToolMenuItems } from './useToolMenuItems';

const SCHEMAS = {
  github: { metadata: { label: 'GitHub' } },
  jira: { metadata: { label: 'Jira Backend Label' } }, // ToolTypes override -> "Jira"
  internal_mcp: { metadata: { label: 'Internal', categories: ['internal_tool'] } },
  hidden_one: { metadata: { label: 'Hidden', hidden: true } },
  no_label_no_override: { type: 'weird' }, // no metadata.label, no ToolTypes override -> filtered out
  sub_agent: { metadata: { label: 'Sub Agent', application: true } },
  mcp: { metadata: { label: 'MCP' }, type: 'mcp' },
  custom_mcp_server: { metadata: { label: 'Custom MCP Server' }, type: 'mcp' },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useToolMenuItems', () => {
  it('is disabled (no fetch, empty items) while projectId is undefined', async () => {
    const { result } = renderHook(() => useToolMenuItems({ projectId: undefined }), { wrapper });
    await waitFor(() => expect(result.current.isFetchingToolkitTypes).toBe(false));
    expect(result.current.toolMenuItems).toEqual([]);
  });

  it('lists non-MCP, non-application toolkit types plus a "Custom" entry, alphabetically sorted', async () => {
    server.use(getListToolkitsMockHandler(SCHEMAS));

    const { result } = renderHook(() => useToolMenuItems({ projectId: 'proj-1' }), { wrapper });
    await waitFor(() => expect(result.current.isFetchingToolkitTypes).toBe(false));

    expect(result.current.toolMenuItems).toEqual([
      { key: 'custom', label: 'Custom' },
      { key: 'github', label: 'GitHub' },
      { key: 'jira', label: 'Jira' },
    ]);
  });

  it('lists only application-type entries when isApplication is true, with no "Custom" entry', async () => {
    server.use(getListToolkitsMockHandler(SCHEMAS));

    const { result } = renderHook(() => useToolMenuItems({ projectId: 'proj-1', isApplication: true }), { wrapper });
    await waitFor(() => expect(result.current.isFetchingToolkitTypes).toBe(false));

    expect(result.current.toolMenuItems).toEqual([{ key: 'sub_agent', label: 'Sub Agent' }]);
  });

  it('lists mcp-flavoured entries (relabelled "Remote MCP") when isMCP is true, with no "Custom" entry', async () => {
    server.use(getListToolkitsMockHandler(SCHEMAS));

    const { result } = renderHook(() => useToolMenuItems({ projectId: 'proj-1', isMCP: true }), { wrapper });
    await waitFor(() => expect(result.current.isFetchingToolkitTypes).toBe(false));

    expect(result.current.toolMenuItems).toEqual([
      { key: 'custom_mcp_server', label: 'Custom MCP Server' },
      { key: 'mcp', label: 'Remote MCP' },
    ]);
  });

  it('returns an empty list (not a crash) against a real, metadata-less backend catalogue', async () => {
    // "database"/"datasource" are real keys the current Go ListTypeSchemas handler serves
    // (services/elitea-main/internal/api/v2/toolkits/handler.go's static map) but carry no
    // ToolTypes FE override and no backend metadata.label at all.
    server.use(
      getListToolkitsMockHandler({
        database: { type: 'object', properties: {} },
        datasource: { type: 'object', properties: {} },
      }),
    );

    const { result } = renderHook(() => useToolMenuItems({ projectId: 'proj-1' }), { wrapper });
    await waitFor(() => expect(result.current.isFetchingToolkitTypes).toBe(false));

    // Neither key has a ToolTypes override or backend metadata.label, so both are filtered
    // out of `entries` -- and the baseline's own `toolMenuItems` useMemo returns [] (not just
    // the predefined "Custom" item) whenever the backend-derived entries list is empty,
    // byte-for-byte (`if (!toolkitsItems || toolkitsItems.length === 0) { return []; }` runs
    // BEFORE the predefined-items branch in useToolMenuItems.jsx) -- ported faithfully, not
    // "fixed", even though it reads like a baseline quirk.
    expect(result.current.toolMenuItems).toEqual([]);
  });
});
