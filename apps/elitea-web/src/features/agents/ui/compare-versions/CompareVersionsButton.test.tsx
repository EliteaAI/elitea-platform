import type { ReactNode } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import type { AgentPipelineVersionOption } from '../../lib/types';
import { CompareVersionsButton } from './CompareVersionsButton';

const BASE = '/api/v2';
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

const versions: AgentPipelineVersionOption[] = [
  { id: 1, name: 'latest', created_at: '2026-01-01T00:00:00Z' },
  { id: 2, name: 'v2', created_at: '2026-03-01T00:00:00Z' },
  { id: 3, name: 'v1', created_at: '2026-02-01T00:00:00Z' },
];

function renderButton(node: ReactNode): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        {node}
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function serveVersion(versionId: number, detail: Record<string, unknown>): void {
  server.use(
    http.get(`${BASE}/elitea_core/version/prompt_lib/7/42/${String(versionId)}`, () => HttpResponse.json(detail)),
  );
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('CompareVersionsButton', () => {
  it('offers nothing when there is only one version — there is nothing to compare against', () => {
    renderButton(
      <CompareVersionsButton
        projectId="7"
        applicationId={42}
        versions={[versions[0] as AgentPipelineVersionOption]}
        activeVersionId={1}
      />,
    );
    expect(screen.queryByTestId('compare-versions-button')).not.toBeInTheDocument();
  });

  it('offers nothing until a version is actually open', () => {
    renderButton(
      <CompareVersionsButton
        projectId="7"
        applicationId={42}
        versions={versions}
        activeVersionId={undefined}
      />,
    );
    expect(screen.queryByTestId('compare-versions-button')).not.toBeInTheDocument();
  });

  it('opens with the newest OTHER version preselected, and never offers the open one', async () => {
    const user = userEvent.setup();
    renderButton(
      <CompareVersionsButton
        projectId="7"
        applicationId={42}
        versions={versions}
        activeVersionId={1}
      />,
    );
    await user.click(screen.getByTestId('compare-versions-button'));
    expect(await screen.findByText('Compare versions')).toBeInTheDocument();
    // The base pane names the open version; the picker holds the newest other one.
    expect(screen.getByText('latest')).toBeInTheDocument();
    expect(screen.getByTestId('compare-versions-select')).toHaveValue('2');
  });

  it('loads both versions and diffs the compared fields', async () => {
    const user = userEvent.setup();
    serveVersion(1, { id: '1', application_id: '42', name: 'latest', status: 'draft', instructions: 'Be helpful.' });
    serveVersion(2, { id: '2', application_id: '42', name: 'v2', status: 'draft', instructions: 'Be friendly.' });

    renderButton(
      <CompareVersionsButton
        projectId="7"
        applicationId={42}
        versions={versions}
        activeVersionId={1}
      />,
    );
    await user.click(screen.getByTestId('compare-versions-button'));
    await user.click(screen.getByRole('button', { name: 'Compare' }));

    const panes = await screen.findAllByTestId('text-diff-modified');
    expect(panes).toHaveLength(2);
    // Each pane shows its OWN version's text; the other side is the baseline
    // it is diffed against, so it must not appear here.
    expect(panes[0]).toHaveTextContent('Be helpful.');
    expect(panes[1]).toHaveTextContent('Be friendly.');
  });

  it('reports a failed version load instead of rendering an empty diff', async () => {
    const user = userEvent.setup();
    serveVersion(1, { id: '1', application_id: '42', name: 'latest', status: 'draft' });
    server.use(
      http.get(`${BASE}/elitea_core/version/prompt_lib/7/42/2`, () => new HttpResponse(null, { status: 500 })),
    );

    renderButton(
      <CompareVersionsButton
        projectId="7"
        applicationId={42}
        versions={versions}
        activeVersionId={1}
      />,
    );
    await user.click(screen.getByTestId('compare-versions-button'));
    await user.click(screen.getByRole('button', { name: 'Compare' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load version details');
    expect(screen.queryByTestId('text-diff-modified')).not.toBeInTheDocument();
  });

  it('goes back to the picker without losing the modal', async () => {
    const user = userEvent.setup();
    serveVersion(1, { id: '1', application_id: '42', name: 'latest', status: 'draft', instructions: 'a' });
    serveVersion(2, { id: '2', application_id: '42', name: 'v2', status: 'draft', instructions: 'b' });

    renderButton(
      <CompareVersionsButton
        projectId="7"
        applicationId={42}
        versions={versions}
        activeVersionId={1}
      />,
    );
    await user.click(screen.getByTestId('compare-versions-button'));
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    await screen.findAllByTestId('text-diff-modified');

    await user.click(screen.getByRole('button', { name: 'Change versions' }));
    await waitFor(() => expect(screen.getByTestId('compare-versions-select')).toBeInTheDocument());
  });
});
