import { beforeAll, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithRouterSocketAndProject } from '../../../__tests__/testUtils';

import { ToolConfluence } from './ToolConfluence';
import type { ToolBaseProps } from './ToolBase';
import type { ToolSchema } from './types';

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.ResizeObserver = StubResizeObserver;
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(
    http.get('/api/v2/elitea_core/platform_settings/prompt_lib', () =>
      HttpResponse.json({
        chat_enabled: true,
        applications_enabled: true,
        skills_enabled: true,
        toolkits_enabled: true,
        datasources_enabled: true,
        pipelines_enabled: true,
        publishing_enabled: true,
        moderation_enabled: true,
        support_chat_enabled: true,
        mcp_enabled: true,
      }),
    ),
  );
  server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})));
});

// `ToolConfluence` -> `ToolBase` renders the real `NameDescriptionInput` by
// default now (R2 fix) — see `ToolBase.test.tsx`'s own `renderToolBase` doc
// comment for why this harness (router + socket, not just query/theme) is
// required.
function renderConfluence(props: ToolBaseProps) {
  return renderWithRouterSocketAndProject(<ToolConfluence {...props} />, 'proj-1');
}

const SCHEMA: ToolSchema = {
  title: 'confluence',
  properties: {
    cloud: { title: 'Cloud', type: 'boolean' },
    space: { title: 'Space', type: 'string' },
    limit: { title: 'Limit', type: 'string' },
    extra_field: { title: 'Extra Field', type: 'string' },
  },
};

describe('ToolConfluence', () => {
  it('excludes the cloud field, matching CONFLUENCE_EXCLUDED_FIELDS', async () => {
    const { getByText, queryByText } = renderConfluence({
      editToolDetail: { name: '', description: '', settings: {} },
      setEditToolDetail: vi.fn(),
      editField: vi.fn(),
      toolErrors: {},
      showValidation: false,
      setToolErrors: vi.fn(),
      schema: SCHEMA,
    });
    await waitFor(() => expect(getByText('Space')).toBeInTheDocument());
    expect(queryByText('Cloud')).not.toBeInTheDocument();
  });

  it('renders space as a priority field before limit', async () => {
    const { container, getByText } = renderConfluence({
      editToolDetail: { name: '', description: '', settings: {} },
      setEditToolDetail: vi.fn(),
      editField: vi.fn(),
      toolErrors: {},
      showValidation: false,
      setToolErrors: vi.fn(),
      schema: SCHEMA,
    });
    await waitFor(() => expect(getByText('Space')).toBeInTheDocument());
    const labels = Array.from(container.querySelectorAll('label')).map((el) => el.textContent ?? '');
    const spaceIndex = labels.findIndex((text) => text.includes('Space'));
    const limitIndex = labels.findIndex((text) => text.includes('Limit'));
    expect(spaceIndex).toBeGreaterThanOrEqual(0);
    expect(spaceIndex).toBeLessThan(limitIndex);
  });

  it('preserves a caller-supplied excludedFields list alongside the Confluence-specific exclusions (main-pass field, not a priority field)', async () => {
    const { getByText, queryByText } = renderConfluence({
      editToolDetail: { name: '', description: '', settings: {} },
      setEditToolDetail: vi.fn(),
      editField: vi.fn(),
      toolErrors: {},
      showValidation: false,
      setToolErrors: vi.fn(),
      schema: SCHEMA,
      excludedFields: ['extra_field'],
    });
    await waitFor(() => expect(getByText('Space')).toBeInTheDocument());
    // The caller's own excludedFields entry ('extra_field') is preserved
    // alongside CONFLUENCE_EXCLUDED_FIELDS ('cloud') — both excluded.
    expect(queryByText('Cloud')).not.toBeInTheDocument();
    expect(queryByText('Extra Field')).not.toBeInTheDocument();
  });

  // R1 regression guard, `ToolConfluence`-specific — see `ToolJira.test.tsx`'s
  // own copy of this test for the full rationale (same crash, same fix,
  // symmetric sibling component).
  it('renders without crashing when given the exact flat prop shape the live ToolkitForm composition root produces', async () => {
    const toolComponentProps: Record<string, unknown> = {
      editToolDetail: { name: 'My Confluence', description: '', settings: {} },
      setEditToolDetail: vi.fn(),
      editField: vi.fn(),
      toolErrors: {},
      setToolErrors: vi.fn(),
      showValidation: false,
      schema: SCHEMA,
      disabledConfigFieldsForOldToolkits: false,
      shouldInitRequiredFields: false,
      isMCP: false,
      disabled: false,
      excludedFields: [],
    };
    const { queryByText, getByText } = renderConfluence(toolComponentProps);
    await waitFor(() => expect(getByText('Space')).toBeInTheDocument());
    expect(queryByText('Cloud')).not.toBeInTheDocument();
  });
});
