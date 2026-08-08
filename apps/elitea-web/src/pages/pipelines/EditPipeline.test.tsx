import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { getGetApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { server } from '@/test/setup';

// Deep import into the slice's own store: test files are excluded from
// dependency-cruiser's `no-deep-slice-import` fence, and the store is the
// observable effect of the seeding this page now performs.
import { usePipelineYamlStore } from '@/features/pipelines/model/pipelineYamlStore';

import { EditPipeline } from './EditPipeline';
import { renderPipelinesRoute, renderPipelinesRouteWithoutSocket } from './__tests__/testRouter';

// `ConfigurationTab`'s real `EditorPanel`/`FlowEditor` needs both jsdom
// polyfills this provides (CodeMirror's YAML mode, `ResizeObserver` for
// react-flow's `<ZoomPane>`) to mount successfully instead of falling back
// to `FlowEditorErrorBoundary`'s own fallback — both are real browser
// standards jsdom simply doesn't implement (real browsers always have
// `ResizeObserver`, so this is a jsdom-only gap, not a production one),
// same as `features/pipelines/ui/EditorPanel.test.tsx`/`YamlCodeEditor.test.tsx`
// and every other test file in this worktree that mounts the real flow
// editor or a CodeMirror instance.
installCodeMirrorTestPolyfills();

const globals = globalThis as unknown as Record<string, unknown>;

/** Same fixture shape `lib/isPublicPipelinesProject.test.ts` already establishes for this exact config surface. */
function setPublicProjectId(publicProjectId: string): void {
  globals['elitea_ui_config'] = {
    vite_server_url: 'https://elitea.example',
    vite_base_uri: '/',
    vite_public_project_id: publicProjectId,
  };
  resetConfigForTests();
}

function detail(
  overrides: { versions?: { id: string; name: string; status: string; agent_type: string; created_at: string }[] } = {},
) {
  return {
    id: '42',
    name: 'My Pipeline',
    description: 'A helpful pipeline',
    icon: '',
    owner_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    versions: overrides.versions ?? [
      { id: '1', name: 'base', status: 'draft', agent_type: 'pipeline', created_at: '2026-01-01T00:00:00Z' },
    ],
    version_details: {
      id: '1',
      application_id: '42',
      name: 'base',
      status: 'draft',
      agent_type: 'pipeline',
      instructions: 'Be helpful.',
      conversation_starters: ['Hi there'],
    },
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
  delete globals['elitea_ui_config'];
  resetConfigForTests();
});

describe('EditPipeline', () => {
  // #135 (read half): the standalone editor page never seeded the flow-editor
  // stores, so a stored pipeline's graph was never shown — the canvas always
  // started from an empty document regardless of what the version held.
  it('seeds the flow-editor YAML store from the loaded version instructions', async () => {
    usePipelineYamlStore.setState({ yamlCode: '', yamlJsonObject: {}, layoutVersion: undefined });
    const graphYaml = 'entry_point: Agent 1\nnodes:\n  - id: Agent 1\n    type: llm\n';
    const base = detail();
    const withGraph = {
      ...base,
      version_details: {
        ...base.version_details,
        instructions: graphYaml,
        pipeline_settings: { layout_version: '1.0' },
      },
    };
    server.use(getGetApplicationMockHandler(withGraph));

    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    await waitFor(() => expect(usePipelineYamlStore.getState().yamlCode).toBe(graphYaml));
    expect(usePipelineYamlStore.getState().layoutVersion).toBe('1.0');
  });

  it('renders the pipeline name once it loads', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    expect(await screen.findByText('My Pipeline')).toBeInTheDocument();
  });

  it('mounts the real ConfigurationTab (GeneralFormPanel + a live EditorPanel/flow editor), not an empty placeholder', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    // `GeneralFormPanel`'s own `data-testid` (`features/pipelines/ui/GeneralFormPanel.tsx`) —
    // proves `ConfigurationTab` itself mounted, not just its disclosed-gap fallback.
    expect(await screen.findByTestId('pipeline-config-tab')).toBeInTheDocument();
    // `EditorPanel`'s own "Add node" trigger — only rendered in its default Flow mode
    // (`EditorPanel.tsx`'s own `mode === PipelineEditorMode.Flow` branch) — proves the
    // real flow editor (not the old unconditional empty
    // `<Box data-testid="edit-pipeline-configuration-tab-panel" />`) is live.
    expect(await screen.findByRole('button', { name: 'Add node' })).toBeInTheDocument();
    // The two REAL cross-slice gaps (no `features/chat`, no promoted `features/agents`
    // configuration panels) still show their own disclosed placeholders, not silently blank areas.
    expect(screen.getByTestId('edit-pipeline-configuration-form-gap')).toBeInTheDocument();
    expect(screen.getByTestId('edit-pipeline-chat-gap')).toBeInTheDocument();
  });

  it('falls back to the disclosed-gap boundary (not a page crash) when no SocketClientContext.Provider is mounted', async () => {
    // Regression guard for the real app-tree state today (verified: `grep -rn
    // "SocketClientContext.Provider" src --include=*.tsx | grep -v test` — zero hits;
    // `useSocketClient()` throws synchronously during `ConfigurationTab`'s render without one).
    // `renderPipelinesRouteWithoutSocket` reproduces that exact gap instead of this file's
    // usual `renderPipelinesRoute` (which wraps with a test socket double, matching the
    // `pages/toolkits/__tests__/testRouter.tsx` precedent).
    server.use(getGetApplicationMockHandler(detail()));
    renderPipelinesRouteWithoutSocket(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    expect(await screen.findByTestId('edit-pipeline-configuration-tab-error')).toBeInTheDocument();
    // The rest of the page — name, Save/Cancel bar — survives the contained error
    // (the boundary fires on the very first render, before the detail fetch resolves).
    expect(await screen.findByText('My Pipeline')).toBeInTheDocument();
    expect(await screen.findByTestId('pipeline-save-button')).toBeInTheDocument();
  });

  it('shows the not-found state when the URL version is not in the versions list', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42/999', { projectId: '9' });

    expect(await screen.findByText('Version not found')).toBeInTheDocument();
  });

  it('skips the not-found check when isFromCreation=true', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    const { router } = renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42/999', { projectId: '9' });
    await waitFor(() => expect(screen.getByText('Version not found')).toBeInTheDocument());

    await router.navigate({
      to: '/pipelines/$tab/$agentId/$version',
      params: { tab: 'all', agentId: '42', version: '999' },
      search: { isFromCreation: 'true' },
      replace: true,
    });

    await waitFor(() => expect(screen.getByText('My Pipeline')).toBeInTheDocument());
    expect(screen.queryByText('Version not found')).not.toBeInTheDocument();
  });

  it('renders the Save/Cancel bar once loaded', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    expect(await screen.findByTestId('pipeline-save-button')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('clicking Cancel does not throw and keeps the page mounted', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    const user = userEvent.setup();
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    await screen.findByText('Cancel');
    await user.click(screen.getByText('Cancel'));

    await waitFor(() => expect(screen.getByTestId('pipeline-config-tab')).toBeInTheDocument());
  });

  it('hides the Save/Cancel bar for a read-only viewer of a public pipeline (viewing under the public project)', async () => {
    setPublicProjectId('42');
    server.use(getGetApplicationMockHandler(detail()));
    renderPipelinesRoute(<EditPipeline />, '/pipelines/latest/42', { projectId: '42' });

    await screen.findByText('My Pipeline');
    expect(screen.queryByTestId('pipeline-save-button')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('still renders the Save/Cancel bar for the same pipeline when the selected project is NOT the public project', async () => {
    setPublicProjectId('42');
    server.use(getGetApplicationMockHandler(detail()));
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    expect(await screen.findByTestId('pipeline-save-button')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('shows a dedicated not-found page when the pipeline-detail fetch 404s (e.g. a deleted/nonexistent pipeline)', async () => {
    server.use(
      http.get('*/elitea_core/application/prompt_lib/:projectId/:applicationId', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/999', { projectId: '9' });

    expect(await screen.findByText('Pipeline not found')).toBeInTheDocument();
    expect(screen.queryByTestId('pipeline-save-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pipeline-config-tab')).not.toBeInTheDocument();
  });

  it('shows a save-error banner (instead of nothing) when a save attempt fails', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });
    const user = userEvent.setup();

    const saveButton = await screen.findByTestId('pipeline-save-button');
    server.use(
      http.put('*/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    await user.click(saveButton);

    expect(await screen.findByText('Failed to save your changes.')).toBeInTheDocument();
  });
});
