import { beforeAll, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithRouterSocketAndProject } from '../../../__tests__/testUtils';

import { ToolJira } from './ToolJira';
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

// `ToolJira` -> `ToolBase` renders the real `NameDescriptionInput` by
// default now (R2 fix) — see `ToolBase.test.tsx`'s own `renderToolBase` doc
// comment for why this harness (router + socket, not just query/theme) is
// required.
function renderJira(props: ToolBaseProps) {
  return renderWithRouterSocketAndProject(<ToolJira {...props} />, 'proj-1');
}

const SCHEMA: ToolSchema = {
  title: 'jira',
  properties: {
    cloud: { title: 'Cloud', type: 'boolean' },
    limit: { title: 'Limit', type: 'string' },
    verify_ssl: { title: 'Verify SSL', type: 'boolean' },
  },
};

describe('ToolJira', () => {
  it('excludes the cloud field, matching JIRA_EXCLUDED_FIELDS', async () => {
    const { getByText, queryByText } = renderJira({
      editToolDetail: { name: '', description: '', settings: {} },
      setEditToolDetail: vi.fn(),
      editField: vi.fn(),
      toolErrors: {},
      showValidation: false,
      setToolErrors: vi.fn(),
      schema: SCHEMA,
    });
    await waitFor(() => expect(getByText('Limit')).toBeInTheDocument());
    expect(queryByText('Cloud')).not.toBeInTheDocument();
  });

  it('renders verify_ssl inside the Advanced Settings accordion', async () => {
    const { getByText } = renderJira({
      editToolDetail: { name: '', description: '', settings: {} },
      setEditToolDetail: vi.fn(),
      editField: vi.fn(),
      toolErrors: {},
      showValidation: false,
      setToolErrors: vi.fn(),
      schema: SCHEMA,
    });
    await waitFor(() => expect(getByText('Advanced Settings')).toBeInTheDocument());
    expect(getByText('Verify SSL')).toBeInTheDocument();
  });

  // R1 regression guard, `ToolJira`-specific: the live composition root
  // resolves `getToolComponent` to `ToolJira` for a jira-typed toolkit and
  // spreads its flat `toolComponentProps` bag directly onto it (no
  // `toolDetail`/`formState` grouping) — `ToolJira` just forwards its own
  // props (plus its field-order overrides) straight to `ToolBase`, so the
  // same crash R1 fixed in `ToolBase` reached here too.
  it('renders without crashing when given the exact flat prop shape the live ToolkitForm composition root produces', async () => {
    const toolComponentProps: Record<string, unknown> = {
      editToolDetail: { name: 'My Jira', description: '', settings: {} },
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
    const { queryByText, getByText } = renderJira(toolComponentProps);
    await waitFor(() => expect(getByText('Limit')).toBeInTheDocument());
    expect(queryByText('Cloud')).not.toBeInTheDocument();
  });
});
