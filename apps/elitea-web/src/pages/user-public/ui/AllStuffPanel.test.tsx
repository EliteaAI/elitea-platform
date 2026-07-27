import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getListApplicationsMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import type { ApplicationList } from '@/shared/api/generated/model';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { server } from '../../../test/setup';

import { AllStuffPanel } from './AllStuffPanel';

function withQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithTheme(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const APP: ApplicationList['rows'][number] = {
  id: 'app-1',
  name: 'Classic Agent',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  owner_id: 'author-1',
  is_forked: false,
  meta: null,
  has_interrupt: false,
};
const PIPELINE: ApplicationList['rows'][number] = {
  id: 'pipe-1',
  name: 'A Pipeline',
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
  owner_id: 'author-1',
  is_forked: false,
  meta: null,
  has_interrupt: false,
};

function mockHandlerDiscriminatingByAgentsType() {
  return getListApplicationsMockHandler((info) => {
    const url = new URL(info.request.url);
    const isPipeline = url.searchParams.get('agents_type') === 'pipeline';
    return {
      rows: isPipeline ? [PIPELINE] : [APP],
      total: 1,
      page: 1,
      page_size: 20,
      total_pages: 1,
    };
  });
}

describe('AllStuffPanel', () => {
  afterEach(() => {
    resetGeneratedClient();
  });

  it('renders an UnavailablePanel in Public viewMode', () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    withQueryClient(
      <AllStuffPanel
        projectId="pub-1"
        authorId="author-1"
        authorName="Ada"
        statuses={[]}
        isPublicProject
        enabled
      />,
    );
    expect(screen.getByText('This list is not available yet.')).toBeInTheDocument();
  });

  it('merges applications and pipelines, newest first', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(mockHandlerDiscriminatingByAgentsType());
    withQueryClient(
      <AllStuffPanel
        projectId="proj-1"
        authorId="author-1"
        authorName="Ada"
        statuses={[]}
        isPublicProject={false}
        enabled
      />,
    );
    await waitFor(() => expect(screen.getByText('A Pipeline')).toBeInTheDocument());
    expect(screen.getByText('Classic Agent')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(['A Pipeline', 'Classic Agent']);
  });

  it('shows the all-stuff empty message when nothing matches', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getListApplicationsMockHandler({ rows: [], total: 0, page: 1, page_size: 20, total_pages: 0 }));
    withQueryClient(
      <AllStuffPanel
        projectId="proj-1"
        authorId="author-1"
        authorName="Ada"
        statuses={[]}
        isPublicProject={false}
        enabled
      />,
    );
    expect(await screen.findByText('Ada has not created anything yet.')).toBeInTheDocument();
  });
});
