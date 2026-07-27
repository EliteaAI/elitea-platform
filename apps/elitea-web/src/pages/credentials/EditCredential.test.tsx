import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server } from '../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { EditCredential } from './EditCredential';

const BASE = '/api/v2';
const CONTEXT = { projectId: '7', isTeamProject: true, canUpdate: true, canDelete: true };

afterEach(() => {
  resetGeneratedClient();
});

describe('EditCredential (ROUTE-025/065 target)', () => {
  it('loads the credential by uid and renders its name', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([{ type: 'openai', config_schema: { title: 'OpenAI', properties: { data: { properties: {} } } } }])));
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () => HttpResponse.json({ uid: 'abc', type: 'openai', elitea_title: 'my-cred', data: {} })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithTheme(
      <QueryClientProvider client={client}>
        <EditCredential
          context={CONTEXT}
          credentialUid="abc"
          onSaved={vi.fn()}
          onDiscarded={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('my-cred'));
  });

  it('titles the screen "Configuration" in configurationMode (ROUTE-065)', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([{ type: 'openai', config_schema: { title: 'OpenAI', properties: { data: { properties: {} } } } }])));
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () => HttpResponse.json({ uid: 'abc', type: 'openai', elitea_title: 'my-cred', data: {} })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithTheme(
      <QueryClientProvider client={client}>
        <EditCredential
          context={CONTEXT}
          credentialUid="abc"
          configurationMode
          onSaved={vi.fn()}
          onDiscarded={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Configuration')).toBeInTheDocument();
  });
});
