import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { getGetApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { server } from '@/test/setup';
import { useNavBlockerStore } from '@/widgets/app-shell';

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

/**
 * The model catalogue the configuration panel's picker reads. Served for
 * every test here — the panel mounts it unconditionally, and
 * `src/test/setup.ts` runs msw with `onUnhandledRequest: 'error'`.
 * `project_id` is spelled as a string because that is what `ConfigModel`
 * declares, while the Go catalogue marshals an int32.
 */
const CATALOGUE = {
  items: [
    { name: 'gpt-4o', display_name: 'GPT-4o', project_id: '9', default: true },
    { name: 'qwen3.5', display_name: 'Qwen 3.5', project_id: '9' },
  ],
  default_model_name: 'gpt-4o',
};

/** Opens the model menu and picks a row by its catalogue display name. */
async function chooseModel(user: ReturnType<typeof userEvent.setup>, displayName: string): Promise<void> {
  await user.click(await screen.findByTestId('model-selector-name'));
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(displayName) }));
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(http.get('*/configurations/models/:projectId', () => HttpResponse.json(CATALOGUE)));
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

  /*
   * The picker rides in `ConfigurationTab`'s configuration-form slot — the
   * left panel, where the baseline puts model settings — so these also pin
   * that it survives alongside the rest of that panel's still-disclosed gap.
   */
  it('mounts the model picker inside the configuration panel, showing the project default', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    const picker = await screen.findByText('GPT-4o');
    expect(picker).toBeVisible();
    // Inside the configuration-form slot, not floating somewhere above the
    // editor — the gap notice for the panels that are still missing stays.
    expect(screen.getByTestId('edit-pipeline-configuration-form-gap')).toContainElement(picker);
  });

  it('reads a stored model back onto the picker instead of the project default', async () => {
    const base = detail();
    server.use(
      getGetApplicationMockHandler({
        ...base,
        version_details: {
          ...base.version_details,
          llm_settings: { model_name: 'qwen3.5', model_project_id: 9, max_tokens: -1, temperature: 0.6 },
        },
      }),
    );
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    expect(await screen.findByText('Qwen 3.5')).toBeVisible();
  });

  it('sends a newly picked model in the version PUT body, with a NUMERIC model_project_id', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.put('*/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: '1', application_id: '42', name: 'base', status: 'draft' }, { status: 201 });
      }),
    );
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });
    const user = userEvent.setup();

    await screen.findByText('GPT-4o');
    await chooseModel(user, 'Qwen 3.5');
    await user.click(await screen.findByTestId('pipeline-save-button'));

    await waitFor(() => expect(bodies).toHaveLength(1));
    const settings = bodies[0]?.['llm_settings'] as Record<string, unknown> | undefined;
    expect(settings?.['model_name']).toBe('qwen3.5');
    expect(settings?.['model_project_id']).toBe(9);
    expect(typeof settings?.['model_project_id']).toBe('number');
  }, 20_000);

  it('leaves llm_settings off the PUT body for a version that names no model and was not re-pointed', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.put('*/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: '1', application_id: '42', name: 'base', status: 'draft' }, { status: 201 });
      }),
    );
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });
    const user = userEvent.setup();

    await screen.findByText('GPT-4o');
    await user.click(await screen.findByTestId('pipeline-save-button'));

    await waitFor(() => expect(bodies).toHaveLength(1));
    // Rendering the catalogue default must not author it — the omitted key
    // is what leaves the platform's own fallback in charge.
    expect(bodies[0]).not.toHaveProperty('llm_settings');
  }, 20_000);

  it('arms the unsaved-changes guard when only the model is changed (#133)', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });
    const user = userEvent.setup();

    await screen.findByText('GPT-4o');
    expect(useNavBlockerStore.getState().isBlockNav).toBe(false);

    await chooseModel(user, 'Qwen 3.5');

    await waitFor(() => expect(useNavBlockerStore.getState().isBlockNav).toBe(true));
  }, 20_000);
});

describe('leaving the editor', () => {
  /**
   * Measured defect (worse than the agents twin's): Discard was
   * `form.reset()` alone, while Save reads the LIVE graph through
   * `usePipelineGraphDraft()` — so a user who edited the canvas, clicked
   * Cancel→Discard, and later clicked Save had the "discarded" edits
   * silently PERSISTED, and stayed on the edit page with no way out.
   * Confirming the discard now reverts the flow-editor stores to their
   * last-loaded snapshot AND leaves for the list, mirroring
   * `pages/agents/EditApplication.tsx`'s `handleDiscarded`.
   */
  it('confirming the discard dialog drops the in-memory draft and navigates back to the pipelines list', async () => {
    const graphYaml = 'entry_point: Agent 1\nnodes:\n  - id: Agent 1\n    type: llm\n';
    const base = detail();
    server.use(
      getGetApplicationMockHandler({
        ...base,
        version_details: { ...base.version_details, instructions: graphYaml },
      }),
    );
    const user = userEvent.setup();
    const { router } = renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    // Wait for the version seed, then simulate a canvas/YAML edit the way the
    // editor writes one — straight into the store the save path reads.
    await waitFor(() => expect(usePipelineYamlStore.getState().yamlCode).toBe(graphYaml));
    // Both halves of the round-trip state, coherently — `EditorPanel`'s own
    // sync effects regenerate `yamlCode` from `yamlJsonObject` when the two
    // disagree, so editing only one would be silently un-edited by the
    // mounted editor rather than by the discard under test.
    usePipelineYamlStore.getState().setYamlJsonObject({ entry_point: 'Edited' });
    usePipelineYamlStore.getState().setYamlCode('entry_point: Edited\n');

    await user.click(await screen.findByText('Cancel'));
    // The dialog's confirm is 'Discard'; the tab bar's own trigger is
    // 'Cancel', so the confirm name is what disambiguates the two.
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    // The in-memory draft is DROPPED, not just hidden: the store the save
    // path reads is back at the loaded snapshot. This is the assertion that
    // fails without the fix — the old discard left 'entry_point: Edited'
    // live for the next Save.
    await waitFor(() => expect(usePipelineYamlStore.getState().yamlCode).toBe(graphYaml));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pipelines/all');
    });
    // #133 — the discard itself must not be prompted about: the navigation
    // happened, so the app-wide blocker was disarmed first.
    expect(useNavBlockerStore.getState().isBlockNav).toBe(false);
  }, 15_000);

  it('dismissing the discard dialog stays on the edit page', async () => {
    server.use(getGetApplicationMockHandler(detail()));
    const user = userEvent.setup();
    const { router } = renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    await user.click(await screen.findByText('Cancel'));
    await screen.findByText('Are you sure you want to discard changes?');
    // Two 'Cancel' buttons exist now — the tab bar's own trigger and the
    // dialog's dismiss. The dialog renders in a portal at the END of the
    // body, so the last match is its button.
    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    await user.click(cancels[cancels.length - 1] as HTMLElement);

    expect(router.state.location.pathname).toBe('/pipelines/all/42');
  }, 15_000);
});

describe('talking to the pipeline', () => {
  /**
   * The page used to offer no way to speak to the pipeline at all (the chat
   * pane is a disclosed gap). The Chat button creates a conversation,
   * attaches THIS pipeline as a participant, and lands in the chat surface.
   * The participant body is the assertion that matters: a pipeline rides as
   * `entity_name: 'application'` behind the `agent_type: 'pipeline'`
   * discriminator (`features/chat-participants/lib/helpers.ts`'s
   * `buildNonModelParticipant`), and `entity_settings.version_id` is what
   * the resolver joins the version through — a participant without it
   * answers 422 on every turn.
   */
  it('the Chat button creates a conversation with the pipeline attached and navigates to it', async () => {
    const participantBodies: unknown[] = [];
    server.use(
      getGetApplicationMockHandler(detail()),
      // RAW bodies, no `{data:…}` envelope: `eliteaFetch` wraps the parsed
      // body itself (`mutator.ts` returns `{data: result.data, …}`), so a
      // mock that pre-wraps lands DOUBLE-wrapped and the client reads
      // `conversation.id === undefined` — the #132 shape, from the other side.
      http.post('*/elitea_core/conversations/prompt_lib/:projectId', () =>
        HttpResponse.json({ id: '7', name: 'My Pipeline' }, { status: 201 }),
      ),
      http.post('*/elitea_core/participants/prompt_lib/:projectId/:conversationId', async ({ request, params }) => {
        participantBodies.push({ conversationId: String(params['conversationId']), body: await request.json() });
        return HttpResponse.json([], { status: 200 });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    await user.click(await screen.findByTestId('chat-with-pipeline-button', {}, { timeout: 5_000 }));

    await waitFor(() => {
      expect(participantBodies).toHaveLength(1);
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/chat/7');
    });
    const captured = participantBodies[0] as { conversationId: string; body: readonly Record<string, unknown>[] };
    expect(captured.conversationId).toBe('7');
    const [participant] = captured.body;
    expect(participant).toMatchObject({
      entity_name: 'application',
      entity_meta: { id: '42', project_id: '9' },
      entity_settings: { version_id: '1', agent_type: 'pipeline' },
    });
  }, 15_000);

  it('a failed conversation create surfaces an error and stays on the page', async () => {
    server.use(
      getGetApplicationMockHandler(detail()),
      http.post('*/elitea_core/conversations/prompt_lib/:projectId', () => HttpResponse.json({}, { status: 500 })),
    );
    const user = userEvent.setup();
    const { router } = renderPipelinesRoute(<EditPipeline />, '/pipelines/all/42', { projectId: '9' });

    await user.click(await screen.findByTestId('chat-with-pipeline-button', {}, { timeout: 5_000 }));

    expect(await screen.findByText('Failed to open a chat with this pipeline.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/pipelines/all/42');
  }, 15_000);
});
