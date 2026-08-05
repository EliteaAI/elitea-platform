import { beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { ThemeProvider } from '@mui/material/styles';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

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
});

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderJira(props: ToolBaseProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        <ToolJira {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
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
  it('excludes the cloud field, matching JIRA_EXCLUDED_FIELDS', () => {
    const { queryByText } = renderJira({
      toolDetail: { value: { name: '', description: '', settings: {} }, onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
    });
    expect(queryByText('Cloud')).not.toBeInTheDocument();
  });

  it('renders verify_ssl inside the Advanced Settings accordion', () => {
    const { getByText } = renderJira({
      toolDetail: { value: { name: '', description: '', settings: {} }, onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
    });
    expect(getByText('Advanced Settings')).toBeInTheDocument();
    expect(getByText('Verify SSL')).toBeInTheDocument();
  });
});
