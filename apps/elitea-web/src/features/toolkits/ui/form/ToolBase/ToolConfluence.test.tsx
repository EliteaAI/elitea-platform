import { beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { ThemeProvider } from '@mui/material/styles';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

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
});

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderConfluence(props: ToolBaseProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        <ToolConfluence {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
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
  it('excludes the cloud field, matching CONFLUENCE_EXCLUDED_FIELDS', () => {
    const { queryByText } = renderConfluence({
      toolDetail: { value: { name: '', description: '', settings: {} }, onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
    });
    expect(queryByText('Cloud')).not.toBeInTheDocument();
  });

  it('renders space as a priority field before limit', () => {
    const { container } = renderConfluence({
      toolDetail: { value: { name: '', description: '', settings: {} }, onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
    });
    const labels = Array.from(container.querySelectorAll('label')).map((el) => el.textContent ?? '');
    const spaceIndex = labels.findIndex((text) => text.includes('Space'));
    const limitIndex = labels.findIndex((text) => text.includes('Limit'));
    expect(spaceIndex).toBeGreaterThanOrEqual(0);
    expect(spaceIndex).toBeLessThan(limitIndex);
  });

  it('preserves a caller-supplied excludedFields list alongside the Confluence-specific exclusions (main-pass field, not a priority field)', () => {
    const { queryByText } = renderConfluence({
      toolDetail: { value: { name: '', description: '', settings: {} }, onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
      fieldOrder: { excludedFields: ['extra_field'] },
    });
    // The caller's own excludedFields entry ('extra_field') is preserved
    // alongside CONFLUENCE_EXCLUDED_FIELDS ('cloud') — both excluded.
    expect(queryByText('Cloud')).not.toBeInTheDocument();
    expect(queryByText('Extra Field')).not.toBeInTheDocument();
  });
});
