import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getListApplicationsMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import type { ApplicationList } from '@/shared/api/generated/model';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../test/setup';

import { ApplicationsPanel } from './ApplicationsPanel';

function withQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithTheme(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const EMPTY_LIST: ApplicationList = { rows: [], total: 0, page: 1, page_size: 20, total_pages: 0 };

describe('ApplicationsPanel', () => {
  afterEach(() => {
    resetGeneratedClient();
  });

  it('renders an UnavailablePanel in Public viewMode, without fetching', () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    withQueryClient(
      <ApplicationsPanel
        projectId="pub-1"
        authorId="author-1"
        authorName="Ada"
        statuses={[]}
        forPipeline={false}
        isPublicProject
        enabled
      />,
    );
    expect(screen.getByText('This list is not available yet.')).toBeInTheDocument();
  });

  it('shows the author-specific empty state once the owner-mode fetch resolves with no matches', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getListApplicationsMockHandler(EMPTY_LIST));
    withQueryClient(
      <ApplicationsPanel
        projectId="proj-1"
        authorId="author-1"
        authorName="Ada"
        statuses={[]}
        forPipeline={false}
        isPublicProject={false}
        enabled
      />,
    );
    expect(await screen.findByText('Ada has not created agent yet.')).toBeInTheDocument();
  });

  it('uses the pipeline-specific empty copy when forPipeline is true', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getListApplicationsMockHandler(EMPTY_LIST));
    withQueryClient(
      <ApplicationsPanel
        projectId="proj-1"
        authorId="author-1"
        authorName="Ada"
        statuses={[]}
        forPipeline
        isPublicProject={false}
        enabled
      />,
    );
    expect(await screen.findByText('Ada has not created pipeline yet.')).toBeInTheDocument();
  });

  it('renders fetched items when the tab is enabled and owner-mode resolves with data', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(
      getListApplicationsMockHandler({
        rows: [
          {
            id: 'app-1',
            name: 'Research Agent',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            owner_id: 'author-1',
            is_forked: false,
            meta: null,
            has_interrupt: false,
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    withQueryClient(
      <ApplicationsPanel
        projectId="proj-1"
        authorId="author-1"
        authorName="Ada"
        statuses={[]}
        forPipeline={false}
        isPublicProject={false}
        enabled
      />,
    );
    await waitFor(() => expect(screen.getByText('Research Agent')).toBeInTheDocument());
  });
});
