/**
 * Adopting models from a platform provider — the `import_llm_models`
 * successor.
 *
 * What is pinned here is what the legacy import got wrong, and what a screen
 * built on top of a provider's own catalogue can still get wrong:
 *
 *  1. **Nothing is published without a decision.** The legacy task created a
 *     row for every model it found, on a schedule. Opening this dialog must
 *     write nothing at all.
 *  2. **The write is the SAME one the manual dialog makes.** A second writer
 *     would have to derive `section`, validate the credential link and run
 *     admission for itself, forever.
 *  3. **An id already published is shown, checked and disabled.** Hiding it
 *     reads as "this provider does not offer it" — and `elitea_title` is
 *     UNIQUE, so the create would be refused rather than duplicated.
 *  4. **A failed listing is not an empty catalogue.** "This provider offers no
 *     models" is the reading an operator acts on.
 *  5. **A partial adoption is reported as partial**, naming the ids that
 *     failed, and the dialog stays open over them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { LlmProviderAdoptModelsDialog } from './LlmProviderAdoptModelsDialog';
import { renderAdminRoute } from './__tests__/testRouter';
import type { LlmProvider } from './api/adminLlmProvidersApi';

const PROVIDER: LlmProvider = {
  id: 4,
  uuid: 'uuid-4',
  elitea_title: 'platform-openai',
  label: '',
  type: 'open_ai',
  status_ok: true,
  status_logs: '',
  endpoint: 'https://api.openai.com/v1',
  settings: {},
  secrets: [{ field: 'api_key', set: true, sealed: true }],
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const MODEL_TYPES = ['asr_model', 'embedding_model', 'image_generation_model', 'llm_model', 'tts_model'];

/** One row of the platform-model listing, filled in around what a test cares about. */
function platformModel(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 91,
    uuid: 'uuid-91',
    elitea_title: '',
    type: 'llm_model',
    section: 'llm',
    status_ok: true,
    status_logs: '',
    model_name: '',
    credential_name: 'platform-openai',
    credential_resolves: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function useCatalogue(items: readonly Record<string, unknown>[] = []): void {
  server.use(
    http.get('*/admin/gateway/platform_models', () =>
      HttpResponse.json({
        items,
        total: items.length,
        public_project_id: 1,
        model_types: MODEL_TYPES,
        credential_names: ['platform-openai'],
      }),
    ),
  );
}

function useProviderModels(body: Record<string, unknown>, status = 200): void {
  server.use(
    http.post('*/admin/gateway/providers/4/models', () => HttpResponse.json(body, { status })),
  );
}

/** Records every platform-model create the dialog makes. */
function recordCreates(
  answer: (draft: Record<string, unknown>) => Response = () =>
    HttpResponse.json({ id: 99 }, { status: 201 }),
): Array<Record<string, unknown>> {
  const created: Array<Record<string, unknown>> = [];
  server.use(
    http.post('*/admin/gateway/platform_models', async ({ request }) => {
      const draft = (await request.json()) as Record<string, unknown>;
      created.push(draft);
      return answer(draft);
    }),
  );
  return created;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: 'https://elitea.example' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('LlmProviderAdoptModelsDialog', () => {
  it('lists what the provider offers and writes nothing until the operator adopts', async () => {
    useCatalogue();
    useProviderModels({ models: ['gpt-4o', 'gpt-4o-mini'], total: 2, truncated: false, type: 'open_ai' });
    const created = recordCreates();

    renderAdminRoute(<LlmProviderAdoptModelsDialog provider={PROVIDER} onClose={() => undefined} />);

    expect(await screen.findByTestId('adopt-models-list')).toHaveTextContent('gpt-4o-mini');
    // The legacy task created a row for every model it found. Opening the
    // dialog must be a read and only a read.
    expect(created).toHaveLength(0);
  });

  it('adopts each selected model through the platform-model route', async () => {
    useCatalogue();
    useProviderModels({ models: ['gpt-4o', 'gpt-4o-mini'], total: 2, truncated: false, type: 'open_ai' });
    const created = recordCreates();
    const user = userEvent.setup();

    renderAdminRoute(<LlmProviderAdoptModelsDialog provider={PROVIDER} onClose={() => undefined} />);
    await screen.findByTestId('adopt-models-list');

    await user.click(screen.getByRole('checkbox', { name: 'gpt-4o' }));
    await user.click(screen.getByTestId('adopt-models-submit'));

    await waitFor(() => expect(created).toHaveLength(1));
    // The provider's own id, in both fields, and the credential named by
    // TITLE — the only link the server admits for a platform model.
    expect(created[0]).toMatchObject({
      elitea_title: 'gpt-4o',
      type: 'llm_model',
      data: { name: 'gpt-4o', ai_credentials: { elitea_title: 'platform-openai' } },
    });
    // Only what was ticked: "select all" was not pressed.
    expect(created).toHaveLength(1);
  });

  it('adopts under the kind the operator chose, never a guessed one', async () => {
    useCatalogue();
    useProviderModels({
      models: ['text-embedding-3-large'],
      total: 1,
      truncated: false,
      type: 'open_ai',
    });
    const created = recordCreates();
    const user = userEvent.setup();

    renderAdminRoute(<LlmProviderAdoptModelsDialog provider={PROVIDER} onClose={() => undefined} />);
    await screen.findByTestId('adopt-models-list');

    // A model filed under the wrong (section, type) pair is invisible to every
    // dispatch path while looking complete in the table, so the kind is asked
    // for rather than read out of a substring of the name.
    await user.click(screen.getByLabelText('Adopt as'));
    await user.click(await screen.findByRole('option', { name: 'Embedding' }));
    await user.click(screen.getByRole('checkbox', { name: 'text-embedding-3-large' }));
    await user.click(screen.getByTestId('adopt-models-submit'));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ type: 'embedding_model' });
  });

  it('shows an already published model checked and disabled, and never re-creates it', async () => {
    useCatalogue([platformModel({ elitea_title: 'gpt-4o', model_name: 'gpt-4o' })]);
    useProviderModels({ models: ['gpt-4o', 'gpt-4o-mini'], total: 2, truncated: false, type: 'open_ai' });
    const created = recordCreates();
    const user = userEvent.setup();

    renderAdminRoute(<LlmProviderAdoptModelsDialog provider={PROVIDER} onClose={() => undefined} />);
    await screen.findByTestId('adopt-models-list');

    const already = screen.getByTestId('adopt-models-item-gpt-4o').querySelector('input');
    expect(already).toBeChecked();
    expect(already).toBeDisabled();
    // Visible, not hidden: an absent row reads as "this provider does not offer
    // it", and sends the operator to look somewhere else.
    expect(screen.getByTestId('adopt-models-list')).toHaveTextContent('Already published');

    // "Select every new model" means the NEW ones. The published id is not one
    // of them, and `elitea_title` is UNIQUE so the create would be refused.
    await user.click(screen.getByTestId('adopt-models-select-all'));
    await user.click(screen.getByTestId('adopt-models-submit'));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ elitea_title: 'gpt-4o-mini' });
  });

  it('reports a failed listing rather than an empty catalogue', async () => {
    useCatalogue();
    useProviderModels({ error: 'The provider rejected the credential.' }, 400);

    renderAdminRoute(<LlmProviderAdoptModelsDialog provider={PROVIDER} onClose={() => undefined} />);

    // The server's own sentence, because it names what to change.
    expect(await screen.findByTestId('adopt-models-load-error')).toHaveTextContent(
      'The provider rejected the credential.',
    );
    // "This provider listed no models" is a different fact, and the one an
    // operator would act on. It must not be shown for a failed read.
    expect(screen.queryByTestId('adopt-models-empty')).toBeNull();
  });

  it('says when the listing was cut short', async () => {
    useCatalogue();
    useProviderModels({ models: ['gpt-4o'], total: 1, truncated: true, type: 'open_ai' });

    renderAdminRoute(<LlmProviderAdoptModelsDialog provider={PROVIDER} onClose={() => undefined} />);

    // Without this, a short list reads as the provider's whole catalogue and an
    // operator concludes a model is not offered.
    expect(await screen.findByTestId('adopt-models-truncated')).toBeVisible();
  });

  it('names the models that failed and stays open over them', async () => {
    useCatalogue();
    useProviderModels({ models: ['gpt-4o', 'gpt-4o-mini'], total: 2, truncated: false, type: 'open_ai' });
    const created = recordCreates((draft) =>
      draft['elitea_title'] === 'gpt-4o-mini'
        ? HttpResponse.json({ error: 'Configuration already exists' }, { status: 400 })
        : HttpResponse.json({ id: 99 }, { status: 201 }),
    );
    let closed = false;
    const user = userEvent.setup();

    renderAdminRoute(
      <LlmProviderAdoptModelsDialog provider={PROVIDER} onClose={() => { closed = true; }} />,
    );
    await screen.findByTestId('adopt-models-list');

    await user.click(screen.getByTestId('adopt-models-select-all'));
    await user.click(screen.getByTestId('adopt-models-submit'));

    // The run does not stop at the first failure: adopting one of two is a
    // better outcome than adopting none.
    await waitFor(() => expect(created).toHaveLength(2));
    const failures = await screen.findByTestId('adopt-models-failures');
    expect(failures).toHaveTextContent('gpt-4o-mini');
    expect(failures).toHaveTextContent('Configuration already exists');
    // A partial adoption reported by closing would read as a complete one.
    expect(closed).toBe(false);
  });

  it('spends no provider round trip while it is closed', async () => {
    useCatalogue();
    let listed = 0;
    server.use(
      http.post('*/admin/gateway/providers/4/models', () => {
        listed += 1;
        return HttpResponse.json({ models: [], total: 0, truncated: false, type: 'open_ai' });
      }),
    );

    renderAdminRoute(
      <LlmProviderAdoptModelsDialog provider={undefined} onClose={() => undefined} />,
    );

    // The route dials a real provider with the stored credential. A dialog that
    // is not open must not cost one.
    await waitFor(() => expect(screen.queryByTestId('adopt-models-list')).toBeNull());
    expect(listed).toBe(0);
  });
});
