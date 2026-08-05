import { beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { ThemeProvider } from '@mui/material/styles';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { ToolBase } from './ToolBase';
import type { ToolBaseProps } from './ToolBase';
import type { EditToolDetail, ToolSchema } from './types';

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.ResizeObserver = StubResizeObserver;
});

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderToolBase(props: ToolBaseProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        <ToolBase {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const SCHEMA: ToolSchema = {
  title: 'jira',
  properties: {
    url: { title: 'URL', type: 'string' },
    label: { title: 'Label', type: 'string' },
  },
  required: ['url'],
};

function detail(overrides: Partial<EditToolDetail> = {}): EditToolDetail {
  return { name: '', description: '', settings: {}, ...overrides };
}

beforeAll(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

function mockPlatformSettings(mcpEnabled: boolean): void {
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
        mcp_enabled: mcpEnabled,
      }),
    ),
  );
}

describe('ToolBase', () => {
  it('renders the schema\'s fields inside a Configuration accordion by default', () => {
    mockPlatformSettings(true);
    const { getByText } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
    });
    expect(getByText('Configuration')).toBeInTheDocument();
    expect(getByText('URL')).toBeInTheDocument();
    expect(getByText('Label')).toBeInTheDocument();
  });

  it('renders flat (no accordion) when context.shouldUseAccordionView is false', () => {
    mockPlatformSettings(true);
    const { queryByText, getByText } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
      context: { shouldUseAccordionView: false },
    });
    expect(queryByText('Configuration')).not.toBeInTheDocument();
    expect(getByText('URL')).toBeInTheDocument();
  });

  it('renders the tools chip picker for the selected_tools schema property', () => {
    mockPlatformSettings(true);
    const schema: ToolSchema = {
      ...SCHEMA,
      properties: { ...SCHEMA.properties, selected_tools: { items: { enum: ['read_issue', 'create_issue'] } } },
    };
    const { getByText } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema,
    });
    expect(getByText('Read issue')).toBeInTheDocument();
    expect(getByText('Create issue')).toBeInTheDocument();
  });

  it('does not render the tools picker when showTools is false', () => {
    mockPlatformSettings(true);
    const schema: ToolSchema = {
      ...SCHEMA,
      properties: { ...SCHEMA.properties, selected_tools: { items: { enum: ['read_issue'] } } },
    };
    const { queryByText } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema,
      fieldVisibility: { showTools: false },
    });
    expect(queryByText('Read issue')).not.toBeInTheDocument();
  });

  it('renders the caller-supplied mcpAuthStatus slot for an mcp-titled schema', () => {
    mockPlatformSettings(true);
    const { getByText } = renderToolBase({
      toolDetail: { value: detail({ type: 'mcp' }), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: { title: 'mcp', properties: {} },
      slots: { mcpAuthStatus: <div>mcp auth status</div> },
    });
    expect(getByText('mcp auth status')).toBeInTheDocument();
  });

  it('does not render the mcpAuthStatus slot for a non-mcp schema', () => {
    mockPlatformSettings(true);
    const { queryByText } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
      slots: { mcpAuthStatus: <div>mcp auth status</div> },
    });
    expect(queryByText('mcp auth status')).not.toBeInTheDocument();
  });

  it('renders the sharepointOAuthStatus slot for a sharepoint-titled schema', () => {
    mockPlatformSettings(true);
    const { getByText } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: { title: 'sharepoint', properties: {} },
      slots: { sharepointOAuthStatus: <div>sharepoint auth status</div> },
    });
    expect(getByText('sharepoint auth status')).toBeInTheDocument();
  });

  it('invokes the renderNameDescriptionInput slot with the resolved name/description context', () => {
    mockPlatformSettings(true);
    const renderNameDescriptionInput = vi.fn(() => <div>name/description widget</div>);
    const { getByText } = renderToolBase({
      toolDetail: { value: detail({ name: 'My Tool', description: 'A tool' }), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
      slots: { renderNameDescriptionInput },
    });
    expect(getByText('name/description widget')).toBeInTheDocument();
    expect(renderNameDescriptionInput).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Tool', description: 'A tool' }));
  });

  it('does not render the name/description slot when hideNameDescriptionInput is set', () => {
    mockPlatformSettings(true);
    const renderNameDescriptionInput = vi.fn(() => <div>name/description widget</div>);
    const { queryByText } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
      fieldVisibility: { hideNameDescriptionInput: true },
      slots: { renderNameDescriptionInput },
    });
    expect(queryByText('name/description widget')).not.toBeInTheDocument();
    expect(renderNameDescriptionInput).not.toHaveBeenCalled();
  });

  it('renders priority fields before the rest of the schema properties', () => {
    mockPlatformSettings(true);
    const { container } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
      fieldOrder: { priorityFieldsOrder: ['label'] },
    });
    const labels = Array.from(container.querySelectorAll('label')).map((el) => el.textContent ?? '');
    const labelIndex = labels.findIndex((text) => text.includes('Label'));
    const urlIndex = labels.findIndex((text) => text.includes('URL'));
    expect(labelIndex).toBeGreaterThanOrEqual(0);
    expect(labelIndex).toBeLessThan(urlIndex);
  });

  it('renders advanced fields inside an "Advanced Settings" accordion, and excludes them from the main pass', () => {
    mockPlatformSettings(true);
    const { getByText, getAllByText } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
      fieldOrder: { advancedFields: ['label'] },
    });
    expect(getByText('Advanced Settings')).toBeInTheDocument();
    // Rendered exactly once — inside the advanced-fields accordion, not
    // duplicated into the main field pass too (`isMainPassField` excludes it).
    expect(getAllByText('Label')).toHaveLength(1);
  });

  it('renders fieldNeedToRenderAtBottom fields after the rest of the schema properties', () => {
    mockPlatformSettings(true);
    const { container } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema: SCHEMA,
      fieldOrder: { fieldNeedToRenderAtBottom: ['url'] },
    });
    const labels = Array.from(container.querySelectorAll('label')).map((el) => el.textContent ?? '');
    const labelIndex = labels.findIndex((text) => text.includes('Label'));
    const urlIndex = labels.findIndex((text) => text.includes('URL'));
    expect(urlIndex).toBeGreaterThanOrEqual(0);
    expect(labelIndex).toBeLessThan(urlIndex);
  });

  it('renders a metadata section (ToolSection) when showSections is set with a matching sectionProps entry', () => {
    mockPlatformSettings(true);
    const schema: ToolSchema = {
      ...SCHEMA,
      properties: { ...SCHEMA.properties, client_id: { title: 'Client ID', type: 'string' } },
    };
    const { getByText, getByRole } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField: vi.fn(),
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema,
      fieldVisibility: { showSections: true },
      sections: {
        sections: { auth: { required: true, subsections: [{ name: 'OAuth', fields: ['client_id'] }] } },
        sectionProps: ['client_id'],
      },
    });
    expect(getByText('Auth')).toBeInTheDocument();
    expect(getByRole('radio', { name: 'OAuth' })).toBeInTheDocument();
  });

  it('commits a selected-tool toggle via editField (the tools chip picker)', async () => {
    mockPlatformSettings(true);
    const editField = vi.fn();
    const schema: ToolSchema = {
      ...SCHEMA,
      properties: { ...SCHEMA.properties, selected_tools: { items: { enum: ['read_issue'] } } },
    };
    const user = userEvent.setup();
    const { getByText } = renderToolBase({
      toolDetail: { value: detail(), onChange: vi.fn() },
      editField,
      formState: { toolErrors: {}, showValidation: false, setToolErrors: vi.fn() },
      schema,
    });
    await user.click(getByText('Read issue'));
    expect(editField).toHaveBeenCalledWith('settings.selected_tools', ['read_issue']);
  });
});
