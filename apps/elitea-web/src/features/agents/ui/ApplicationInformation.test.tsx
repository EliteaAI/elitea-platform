import type { ComponentProps } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { server } from '@/test/setup';

import { createTestQueryClient } from '../__tests__/testUtils';
import { ApplicationInformation } from './ApplicationInformation';

/** `CopyToClipboardButton`/`StyledShowContextModal` read `theme.vars.palette.*` — this file drives its own `RouterProvider` (needed for `useSelectedProjectId`'s `useRouteContext`) rather than the shared `renderWithProviders` helper, so the theme has to be wired in here too. */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

function renderInfo(props: Partial<ComponentProps<typeof ApplicationInformation>> = {}) {
  const queryClient = createTestQueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <ApplicationInformation
            id="app-1"
            versionId="v1"
            isPipeline={false}
            {...props}
          />
        </ThemeProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => 'proj-1' } },
  });
  return render(<RouterProvider router={router} />);
}

describe('ApplicationInformation', () => {
  it('shows the agent id and copy affordance', async () => {
    renderInfo();
    expect(await screen.findByTestId('copy-id')).toBeInTheDocument();
    expect(screen.getByText('Agent ID:')).toBeInTheDocument();
  });

  it('shows the version id when present', async () => {
    renderInfo();
    expect(await screen.findByText('Version ID:')).toBeInTheDocument();
  });

  it('labels the id "Pipeline ID:" when isPipeline is set', async () => {
    renderInfo({ isPipeline: true });
    expect(await screen.findByText('Pipeline ID:')).toBeInTheDocument();
  });

  it('shows a "Forked from" row with the fallback label while the original application is unresolved', async () => {
    renderInfo({ isForked: true, forkedProjectId: 'p2', forkedApplicationId: 'app-2' });
    expect(await screen.findByText('Forked from:')).toBeInTheDocument();
    expect(screen.getByText('Original agent')).toBeInTheDocument();
  });

  it('shows the original application name once the fork lookup resolves', async () => {
    server.use(
      http.get('*/elitea_core/application/prompt_lib/:projectId/:applicationId', () =>
        HttpResponse.json({
          id: 'app-2',
          name: 'Original Agent Name',
          description: '',
          icon: '',
          owner_id: 'u1',
          created_at: '2026-01-01T00:00:00Z',
          versions: [],
        }),
      ),
    );
    renderInfo({ isForked: true, forkedProjectId: 'p2', forkedApplicationId: 'app-2' });
    expect(await screen.findByText('Original Agent Name')).toBeInTheDocument();
  });

  it('renders a "Show" link that opens the pipeline modal', async () => {
    renderInfo({ showPipeline: true, pipelineInstructions: 'nodes: []' });
    const showLink = await screen.findByText('Show');
    expect(screen.getByText('Pipeline:')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    showLink.click();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  describe('pipeline trigger rows', () => {
    it('renders the trigger type row for a chat_message trigger, with no schedule/webhook rows', async () => {
      server.use(
        http.get('*/elitea_core/pipeline_trigger/prompt_lib/:projectId/pipeline/:versionId/trigger', () =>
          HttpResponse.json({ versionId: 'v1', enabled: true, type: 'chat_message', schedule: null }),
        ),
      );
      renderInfo({ isPipeline: true, versionId: 'v1' });
      expect(await screen.findByText('Trigger:')).toBeInTheDocument();
      expect(screen.getByText('Chat Message')).toBeInTheDocument();
      expect(screen.queryByText('Schedule:')).not.toBeInTheDocument();
      expect(screen.queryByText('Webhook type:')).not.toBeInTheDocument();
    });

    it('renders cron/timezone/last-run rows for a schedule trigger', async () => {
      server.use(
        http.get('*/elitea_core/pipeline_trigger/prompt_lib/:projectId/pipeline/:versionId/trigger', () =>
          HttpResponse.json({
            versionId: 'v1',
            enabled: true,
            type: 'schedule',
            schedule: { cron: '0 9 * * *', timezone: 'UTC', last_run: '2026-07-20T09:00:00Z' },
          }),
        ),
      );
      renderInfo({ isPipeline: true, versionId: 'v1' });
      expect(await screen.findByText('Trigger:')).toBeInTheDocument();
      expect(screen.getByText('Schedule')).toBeInTheDocument();
      expect(screen.getByText('Schedule:')).toBeInTheDocument();
      expect(screen.getByText('0 9 * * *')).toBeInTheDocument();
      expect(screen.getByText('Timezone:')).toBeInTheDocument();
      expect(screen.getByText('UTC')).toBeInTheDocument();
      expect(screen.getByText('Last run:')).toBeInTheDocument();
    });

    it('omits cron/timezone/last-run rows a schedule trigger does not carry', async () => {
      server.use(
        http.get('*/elitea_core/pipeline_trigger/prompt_lib/:projectId/pipeline/:versionId/trigger', () =>
          HttpResponse.json({ versionId: 'v1', enabled: true, type: 'schedule', schedule: {} }),
        ),
      );
      renderInfo({ isPipeline: true, versionId: 'v1' });
      expect(await screen.findByText('Trigger:')).toBeInTheDocument();
      expect(screen.queryByText('Schedule:')).not.toBeInTheDocument();
      expect(screen.queryByText('Timezone:')).not.toBeInTheDocument();
      expect(screen.queryByText('Last run:')).not.toBeInTheDocument();
    });

    it('renders the webhook type row for a webhook trigger', async () => {
      server.use(
        http.get('*/elitea_core/pipeline_trigger/prompt_lib/:projectId/pipeline/:versionId/trigger', () =>
          HttpResponse.json({
            versionId: 'v1',
            enabled: true,
            type: 'webhook',
            schedule: { webhook_type: 'github' },
          }),
        ),
      );
      renderInfo({ isPipeline: true, versionId: 'v1' });
      expect(await screen.findByText('Trigger:')).toBeInTheDocument();
      expect(screen.getByText('Webhook type:')).toBeInTheDocument();
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });

    it('renders no trigger row at all when isPipeline is false, even with a versionId', async () => {
      renderInfo({ isPipeline: false, versionId: 'v1' });
      await screen.findByText('Version ID:');
      expect(screen.queryByText('Trigger:')).not.toBeInTheDocument();
    });
  });

  describe('forked-from permission tooltip', () => {
    it('is not disabled and has the "go to original" tooltip when the fork lookup succeeds', async () => {
      server.use(
        http.get('*/elitea_core/application/prompt_lib/:projectId/:applicationId', () =>
          HttpResponse.json({
            id: 'app-2',
            name: 'Original Agent Name',
            description: '',
            icon: '',
            owner_id: 'u1',
            created_at: '2026-01-01T00:00:00Z',
            versions: [],
          }),
        ),
      );
      renderInfo({ isForked: true, forkedProjectId: 'p2', forkedApplicationId: 'app-2' });
      const nameNode = await screen.findByText('Original Agent Name');
      expect(nameNode).toHaveAttribute('aria-disabled', 'false');
    });

    it('marks the row aria-disabled on a 403 from the fork lookup', async () => {
      server.use(
        http.get('*/elitea_core/application/prompt_lib/:projectId/:applicationId', () =>
          HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
        ),
      );
      renderInfo({ isForked: true, forkedProjectId: 'p2', forkedApplicationId: 'app-2' });
      const nameNode = await screen.findByText('Original agent');
      await waitFor(() => expect(nameNode).toHaveAttribute('aria-disabled', 'true'));
    });
  });
});
