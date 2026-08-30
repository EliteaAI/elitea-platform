import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ApplicationCreationInput } from '@/entities/application-form';
import type { PipelineGraphDraft } from '@/features/pipelines';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { getGetApplicationQueryKey } from '@/shared/api/generated/applications/applications';
import type { ApplicationVersionDetail, ApplicationVersionSummary } from '@/shared/api/generated/model';
import { server } from '@/test/setup';

import { renderPipelinesRoute } from '../__tests__/testRouter';

import { usePipelineVersionControls } from './usePipelineVersionControls';

/**
 * Driven through this unit's REAL router fixture rather than a mocked
 * `useNavigate` — R-M1 (`elitea/no-vi-mock`) allows only the MSW network
 * boundary to be substituted, and a mocked navigate would in any case prove
 * only that the hook called a function, not that the route it names resolves.
 * Asserting `router.state.location.pathname` proves the latter, which matters
 * here: `/pipelines/:tab/:agentId/:version` is the whole mechanism by which
 * choosing a version LOADS that version's graph.
 */
const versions: readonly ApplicationVersionSummary[] = [
  { id: '1', name: 'base', status: 'draft', agent_type: 'pipeline', created_at: '2026-01-01T00:00:00Z' },
  { id: '2', name: 'v1', status: 'draft', agent_type: 'pipeline', created_at: '2026-01-02T00:00:00Z' },
];

const activeVersion = {
  id: '1',
  application_id: '42',
  name: 'base',
  status: 'draft',
  agent_type: 'pipeline',
  instructions: 'entry_point: LLM_1\nnodes: []\n',
  meta: { step_limit: 40, internal_tools: [] },
} as unknown as ApplicationVersionDetail;

const liveGraph: PipelineGraphDraft = {
  instructions: 'entry_point: LLM_9\nnodes:\n  - id: LLM_9\n    type: llm\n',
  pipelineSettings: {
    nodes: [{ id: 'LLM_9', position: { x: 120, y: 240 } }],
    edges: [],
    orientation: 'vertical',
    layout_version: '1.0',
  },
};

interface ProbeProps {
  readonly readGraphDraft: () => PipelineGraphDraft | undefined;
  readonly version?: ApplicationVersionDetail | undefined;
}

function Probe({ readGraphDraft, version = activeVersion }: ProbeProps) {
  const form = useForm<ApplicationCreationInput>({
    values: { name: 'p', description: 'd', version_details: { conversation_starters: ['live starter'] } },
  });
  const state = usePipelineVersionControls({
    projectId: '9',
    applicationId: 42,
    tab: 'my',
    versions,
    activeVersion: version,
    control: form.control,
    llmSettings: undefined,
    readGraphDraft,
    isReadOnly: false,
    isFetching: false,
  });
  return (
    <div>
      <span data-testid="body">{JSON.stringify(state.versionBody)}</span>
      <span data-testid="error">{String(state.versionError)}</span>
      <button
        data-testid="select"
        onClick={() => state.handleSelectVersion({ id: 2, name: 'v1' })}
      >
        select
      </button>
      <button
        data-testid="saved"
        onClick={() => state.handleNewVersionSaved({ id: '7' } as ApplicationVersionDetail)}
      >
        saved
      </button>
      <button
        data-testid="deleted"
        onClick={() => state.versionDelete?.onVersionDeleted()}
      >
        deleted
      </button>
    </div>
  );
}

/** Every PUT this hook's graph-carry issues, in order. */
function captureVersionPuts(): { url: string; body: Record<string, unknown> }[] {
  const puts: { url: string; body: Record<string, unknown> }[] = [];
  server.use(
    http.put('*/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId', async ({ request }) => {
      puts.push({ url: request.url, body: (await request.json()) as Record<string, unknown> });
      return HttpResponse.json({ id: '7', application_id: '42', name: 'v2', status: 'draft' }, { status: 200 });
    }),
  );
  return puts;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  return () => resetGeneratedClient();
});

describe('usePipelineVersionControls', () => {
  it('switching versions navigates onto the version route, which is what re-seeds the graph', async () => {
    const { router } = renderPipelinesRoute(<Probe readGraphDraft={() => undefined} />, '/pipelines/my/42');
    await userEvent.setup().click(await screen.findByTestId('select'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/pipelines/my/42/2'));
  });

  it('deleting the open version leaves for the pipeline default-version route', async () => {
    const { router } = renderPipelinesRoute(<Probe readGraphDraft={() => undefined} />, '/pipelines/my/42/1');
    await userEvent.setup().click(await screen.findByTestId('deleted'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/pipelines/my/42'));
  });

  /**
   * The gap this hook exists to close. `CreateVersion`/`versionFromBody`
   * reads no `pipeline_settings` key and `insertVersion`'s INSERT does not
   * name the column, so the POST alone leaves the new version with an empty
   * graph geometry and the previously STORED `instructions` — a "Save As
   * Version" taken after editing the canvas would clone the graph the user
   * had already moved past. The follow-up PUT is the only write path that
   * can carry either.
   */
  it('carries the LIVE graph onto the created version with a PUT aimed at its id', async () => {
    const puts = captureVersionPuts();
    const { router } = renderPipelinesRoute(<Probe readGraphDraft={() => liveGraph} />, '/pipelines/my/42/1');

    await userEvent.setup().click(await screen.findByTestId('saved'));

    await waitFor(() => expect(puts).toHaveLength(1));
    // Aimed at the id the POST just minted (7), not at the version that was open (1).
    expect(puts[0]?.url).toContain('/version/prompt_lib/9/42/7');
    expect(puts[0]?.body['instructions']).toBe(liveGraph.instructions);
    const settings = puts[0]?.body['pipeline_settings'] as Record<string, unknown>;
    expect(settings['nodes']).toEqual([{ id: 'LLM_9', position: { x: 120, y: 240 } }]);
    expect(settings['layout_version']).toBe('1.0');

    // …and the navigation happens AFTER the carry, so the editor re-seeds
    // from a version that already holds the graph.
    await waitFor(() => expect(router.state.location.pathname).toBe('/pipelines/my/42/7'));
  });

  /**
   * `usePipelineGraphDraft` returns `undefined` when the editor holds nothing
   * to save (not mounted, or not seeded yet). Writing then would blank a real
   * stored pipeline — the louder version of the data loss #135 removed.
   */
  it('sends no PUT at all when the flow editor holds nothing to carry', async () => {
    const puts = captureVersionPuts();
    const { router } = renderPipelinesRoute(<Probe readGraphDraft={() => undefined} />, '/pipelines/my/42/1');

    await userEvent.setup().click(await screen.findByTestId('saved'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/pipelines/my/42/7'));
    expect(puts).toHaveLength(0);
  });

  /**
   * A failed carry must not read as a clean save. The version really was
   * created, so the navigation still happens; the refusal is reported instead
   * of swallowed (this app has no toast infrastructure).
   */
  it('reports a failed graph carry and still lands on the created version', async () => {
    server.use(
      http.put('*/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 }),
      ),
    );
    const { router } = renderPipelinesRoute(<Probe readGraphDraft={() => liveGraph} />, '/pipelines/my/42/1');

    await userEvent.setup().click(await screen.findByTestId('saved'));

    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent(
        'The new version was created, but its flow graph could not be copied onto it.',
      ),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/pipelines/my/42/7'));
  });

  /**
   * The dropdown's source is the application-detail response, which is stale
   * by exactly the new entry the moment the POST resolves — `useSaveNewVersion`
   * deliberately invalidates nothing.
   */
  it('invalidates the application detail so the new version appears in the dropdown', async () => {
    captureVersionPuts();
    // `gcTime: Infinity`, not the fixture's default 0: an unobserved entry is
    // collected the moment it is written, and `getQueryState` would then
    // answer `undefined` whether the invalidation happened or not — a test
    // that cannot fail for the right reason.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const key = getGetApplicationQueryKey('9', 42);
    queryClient.setQueryData(key, { data: { id: '42', versions: [] } });

    renderPipelinesRoute(<Probe readGraphDraft={() => liveGraph} />, '/pipelines/my/42/1', { queryClient });
    await userEvent.setup().click(await screen.findByTestId('saved'));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it('clones the live conversation starters and the pipeline agent_type into the create body', async () => {
    renderPipelinesRoute(<Probe readGraphDraft={() => undefined} />, '/pipelines/my/42/1');
    const body = JSON.parse((await screen.findByTestId('body')).textContent ?? '{}') as Record<string, unknown>;

    expect(body['agent_type']).toBe('pipeline');
    expect(body['conversation_starters']).toEqual(['live starter']);
    expect(body['meta']).toEqual({ step_limit: 40, internal_tools: [] });
  });
});
