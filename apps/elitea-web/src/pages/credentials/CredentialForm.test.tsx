/**
 * CredentialForm.test.tsx — integration coverage for the create/edit
 * credential screen (unit A7). Real router-free integration: real
 * QueryClient, real MSW-mocked network, no `vi.mock()` of application code
 * (R-M1). Covers ACT-040 (create via Save) and ACT-041 (test connection).
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { server } from '../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CredentialForm } from './CredentialForm';
import type { CredentialFormContext } from './CredentialForm';

const BASE = '/api/v2';

/**
 * jsdom has no `ResizeObserver` — `CredentialTypeSelector`'s
 * `CategoryItemCard` tiles use `shared/ui/lib/useTextOverflow`, which
 * constructs one. Same stub `CategoryItemCard.test.tsx` already
 * establishes (a no-op is enough; overflow detection runs off mount-time
 * timers, not observer callbacks).
 */
class ResizeObserverStub {
  observe(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

const CONTEXT: CredentialFormContext = {
  projectId: '7',
  isTeamProject: true,
  canUpdate: true,
  canDelete: true,
};

function renderForm(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderWithTheme(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  resetGeneratedClient();
  vi.unstubAllGlobals();
});

const OPENAI_TYPE = {
  type: 'openai',
  section: 'credentials',
  config_schema: {
    title: 'OpenAI',
    properties: {
      data: {
        properties: {
          api_key: { type: 'string', title: 'API Key', secret: true },
        },
      },
    },
  },
  has_test_connection: true,
};

describe('CredentialForm — create flow', () => {
  it('shows the type selector first, then the field form once a type is chosen', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'create' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('OpenAI')).toBeInTheDocument());
    fireEvent.click(screen.getByText('OpenAI'));
    expect(await screen.findByText('API Key')).toBeInTheDocument();
  });

  it('skips the type selector when mode.credentialType is already set', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'create', credentialType: 'openai' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    expect(await screen.findByText('API Key')).toBeInTheDocument();
  });

  it('disables Save until a name is entered (ACT-040 precondition)', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'create', credentialType: 'openai' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await screen.findByText('API Key');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('ACT-040: Save dispatches POST /configurations/configurations/{projectId} and calls onSaved', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/configurations/configurations/7`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ uid: 'new-1', type: 'openai' });
      }),
    );
    const onSaved = vi.fn();
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'create', credentialType: 'openai' }}
        onSaved={onSaved}
        onDiscarded={vi.fn()}
      />,
    );
    await screen.findByText('API Key');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my-openai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(capturedBody).toMatchObject({ type: 'openai', elitea_title: 'my-openai', label: 'my-openai' });
  });

  it('surfaces a generic save error without losing the entered name', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(http.post(`${BASE}/configurations/configurations/7`, () => new HttpResponse(null, { status: 500 })));
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'create', credentialType: 'openai' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await screen.findByText('API Key');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my-openai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Failed to save credential')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('my-openai');
  });

  it('maps a field-specific API error onto the offending schema field, not the generic banner', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(
      http.post(`${BASE}/configurations/configurations/7`, () => HttpResponse.json({ error: 'api_key is invalid' }, { status: 400 })),
    );
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'create', credentialType: 'openai' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await screen.findByText('API Key');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my-openai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('api_key is invalid')).toBeInTheDocument();
    expect(screen.queryByText('Failed to save credential')).not.toBeInTheDocument();
  });

  it('renders boolean/number/enum schema fields with their own widgets, and submits their edited values', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    const richType = {
      type: 'richtype',
      section: 'credentials',
      config_schema: {
        title: 'Rich Type',
        properties: {
          data: {
            properties: {
              enabled: { type: 'boolean', title: 'Enabled' },
              port: { type: 'number', title: 'Port' },
              region: { type: 'string', title: 'Region', enum: ['us', 'eu'] },
            },
          },
        },
      },
    };
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([richType])));
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/configurations/configurations/7`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ uid: 'new-1', type: 'richtype' });
      }),
    );
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'create', credentialType: 'richtype' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await screen.findByText('Enabled');
    expect(screen.getByText('Port')).toBeInTheDocument();
    expect(screen.getByText('Region')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my-rich' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(capturedBody).toBeDefined());
    expect((capturedBody as { data: Record<string, unknown> }).data['enabled']).toBe(true);
  });

  it('ACT-041: the Test connection button dispatches POST /check_connection/{projectId}/{configType}', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    let url = '';
    server.use(
      http.post(`${BASE}/configurations/check_connection/7/openai`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({});
      }),
    );
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'create', credentialType: 'openai' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await screen.findByText('API Key');
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(url).toContain('/configurations/check_connection/7/openai'));
    expect(await screen.findByText('Connection successful')).toBeInTheDocument();
  });

  it('reports a failed test connection', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(http.post(`${BASE}/configurations/check_connection/7/openai`, () => HttpResponse.json({ error: 'bad key' })));
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'create', credentialType: 'openai' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await screen.findByText('API Key');
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('bad key')).toBeInTheDocument();
  });
});

describe('CredentialForm — edit flow', () => {
  it('loads the existing credential and shows its data, name, and Delete control', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () =>
        HttpResponse.json({ uid: 'abc', type: 'openai', elitea_title: 'existing-cred', data: { api_key: 'sk-existing' }, shared: false }),
      ),
    );
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'edit', configId: 'abc' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('existing-cred'));
    expect(screen.getByRole('button', { name: 'Credential actions' })).toBeInTheDocument();
  });

  it('Save dispatches PUT /configurations/configuration/{projectId}/{configId} in edit mode', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () =>
        HttpResponse.json({ uid: 'abc', type: 'openai', elitea_title: 'existing-cred', data: { api_key: 'sk-existing' } }),
      ),
    );
    let method = '';
    server.use(
      http.put(`${BASE}/configurations/configuration/7/abc`, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ uid: 'abc' });
      }),
    );
    const onSaved = vi.fn();
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'edit', configId: 'abc' }}
        onSaved={onSaved}
        onDiscarded={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('existing-cred'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(method).toBe('PUT');
  });

  it('deleting through CredentialsControls dispatches DELETE and calls onDiscarded', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () =>
        HttpResponse.json({ uid: 'abc', type: 'openai', elitea_title: 'existing-cred', data: {} }),
      ),
    );
    let deleteMethod = '';
    server.use(
      http.delete(`${BASE}/configurations/configuration/7/abc`, ({ request }) => {
        deleteMethod = request.method;
        return HttpResponse.json({});
      }),
    );
    const onDiscarded = vi.fn();
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'edit', configId: 'abc' }}
        onSaved={vi.fn()}
        onDiscarded={onDiscarded}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('existing-cred'));
    fireEvent.click(screen.getByRole('button', { name: 'Credential actions' }));
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'existing-cred' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteMethod).toBe('DELETE'));
    expect(onDiscarded).toHaveBeenCalledTimes(1);
  });

  it('seeds Name from the stored label (not elitea_title), and a no-op save never rewrites either field (regression: A7-pages finding 1)', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () =>
        HttpResponse.json({
          uid: 'abc',
          type: 'openai',
          elitea_title: 'internal-key-v1',
          label: 'My Prod Key',
          data: { api_key: 'sk-existing' },
        }),
      ),
    );
    let capturedBody: unknown;
    server.use(
      http.put(`${BASE}/configurations/configuration/7/abc`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ uid: 'abc' });
      }),
    );
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'edit', configId: 'abc' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    // The visible Name box shows the freely-editable display label — not
    // the internally-stable elitea_title lookup key — even though the old
    // (buggy) seed order preferred elitea_title.
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('My Prod Key'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(capturedBody).toBeDefined());
    // Zero user changes: label must round-trip unchanged, and elitea_title
    // must stay exactly what the server sent — never overwritten with the
    // label value.
    expect(capturedBody).toMatchObject({ elitea_title: 'internal-key-v1', label: 'My Prod Key' });
  });

  it('a deliberate rename updates label but keeps elitea_title stable (regression: A7-pages finding 1)', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () =>
        HttpResponse.json({
          uid: 'abc',
          type: 'openai',
          elitea_title: 'internal-key-v1',
          label: 'My Prod Key',
          data: { api_key: 'sk-existing' },
        }),
      ),
    );
    let capturedBody: unknown;
    server.use(
      http.put(`${BASE}/configurations/configuration/7/abc`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ uid: 'abc' });
      }),
    );
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'edit', configId: 'abc' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('My Prod Key'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Prod Key v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(capturedBody).toBeDefined());
    // The rename reaches `label`; `elitea_title` — what other domains
    // resolve this credential by — is untouched by the rename.
    expect(capturedBody).toMatchObject({ elitea_title: 'internal-key-v1', label: 'My Prod Key v2' });
  });

  it("disables Delete with a reason on a project's last vectorstorage configuration (regression: A7-pages finding 2)", async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () =>
        HttpResponse.json({ uid: 'abc', type: 'openai', elitea_title: 'only-pgvector', section: 'vectorstorage', data: {} }),
      ),
    );
    server.use(
      http.get(`${BASE}/configurations/configurations/7`, () =>
        HttpResponse.json({ items: [{ uid: 'abc' }], total: 1, limit: 2, offset: 0, shared: { items: [], total: 0 } }),
      ),
    );
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'edit', configId: 'abc' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('only-pgvector'));
    fireEvent.click(screen.getByRole('button', { name: 'Credential actions' }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByLabelText('Cannot delete the only pgVector configuration. At least one is required for the project.')).toBeInTheDocument();
  });

  it('keeps Delete enabled when a second configuration exists in the same protected section (regression: A7-pages finding 2)', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () =>
        HttpResponse.json({ uid: 'abc', type: 'openai', elitea_title: 'one-of-two', section: 'vectorstorage', data: {} }),
      ),
    );
    server.use(
      http.get(`${BASE}/configurations/configurations/7`, () =>
        HttpResponse.json({
          items: [{ uid: 'abc' }, { uid: 'def' }],
          total: 2,
          limit: 2,
          offset: 0,
          shared: { items: [], total: 0 },
        }),
      ),
    );
    server.use(
      http.delete(`${BASE}/configurations/configuration/7/abc`, () => HttpResponse.json({})),
    );
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'edit', configId: 'abc' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('one-of-two'));
    // Re-clicks the trigger on every poll (not just once before waiting):
    // `CredentialsControls`'s disabled-vs-enabled branches are two
    // differently-shaped trees (`Tooltip`-wrapped vs bare), so the section
    // guard settling from its conservative "blocked" default to "allowed"
    // remounts the open dropdown out from under a menu opened before that
    // — see this file's own `useDeleteGuard` doc comment for the
    // out-of-scope fix this needs in `CredentialsControls.tsx`. Clicking
    // inside the poll re-opens whatever instance is current, so this
    // assertion is robust to that remount rather than racing it.
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Credential actions' }));
      expect(screen.getByRole('menuitem', { name: 'Delete' })).not.toHaveAttribute('aria-disabled', 'true');
    });
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete confirmation')).toBeInTheDocument();
  });

  it('disables Delete when canDelete is false', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () =>
        HttpResponse.json({ uid: 'abc', type: 'openai', elitea_title: 'existing-cred', data: {} }),
      ),
    );
    renderForm(
      <CredentialForm
        context={{ ...CONTEXT, canDelete: false }}
        mode={{ kind: 'edit', configId: 'abc' }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('existing-cred'));
    fireEvent.click(screen.getByRole('button', { name: 'Credential actions' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('CredentialForm — configuration mode (ROUTE-063..065)', () => {
  it('titles the screen "Configuration" instead of "Credential"', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([OPENAI_TYPE])));
    renderForm(
      <CredentialForm
        context={CONTEXT}
        mode={{ kind: 'create', credentialType: 'openai', configurationMode: true }}
        onSaved={vi.fn()}
        onDiscarded={vi.fn()}
      />,
    );
    expect(await screen.findByText('Configuration')).toBeInTheDocument();
    expect(screen.queryByText('Credential', { selector: 'h3, h4, h5, h6' })).not.toBeInTheDocument();
  });
});
