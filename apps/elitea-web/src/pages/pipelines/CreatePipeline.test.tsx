import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { getCreateApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { CreatePipeline } from './CreatePipeline';
import { renderPipelinesRoute } from './__tests__/testRouter';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('CreatePipeline', () => {
  it('renders the Save/Cancel tab bar and a form panel containing the real fields', async () => {
    renderPipelinesRoute(<CreatePipeline />, '/pipelines/create', { projectId: '1' });

    expect(await screen.findByTestId('pipeline-save-button')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();

    // `toBeInTheDocument()` on the panel alone is what let this page ship a
    // self-closing `<Box data-testid="create-pipeline-form-panel" />` with a
    // green unit test — an empty div is in the document. The E2E journey (J16)
    // caught it only because a real browser cannot SEE an empty box. Assert on
    // the fields the panel is supposed to contain, so the container can never
    // again pass while hollow.
    const panel = screen.getByTestId('create-pipeline-form-panel');
    expect(await screen.findByTestId('agent-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('agent-description-input')).toBeInTheDocument();
    expect(panel).toContainElement(screen.getByTestId('agent-name-input'));
    expect(panel).toContainElement(screen.getByTestId('agent-description-input'));
  });

  it('typing a name and description enables Save (the panel is wired, not just present)', async () => {
    // `delay: null`: userEvent's default inter-keystroke delay re-renders the
    // whole form between characters, and this panel now contains the real
    // `CreateAgentForm` (several MUI accordions) rather than an empty Box. At
    // the default delay the two short strings below took over 5s on CI and
    // timed out. Removing the artificial delay keeps every keystroke — and so
    // every `onFieldChange` round trip this test exists to prove — intact.
    const user = userEvent.setup({ delay: null });
    renderPipelinesRoute(<CreatePipeline />, '/pipelines/create', { projectId: '1' });

    // Save is gated on applicationCreationSchema, which requires BOTH fields.
    // Driving the real inputs proves onFieldChange reaches the RHF form —
    // rendering the fields but leaving them unwired would fail here.
    expect(await screen.findByTestId('pipeline-save-button')).toBeDisabled();

    await user.type(screen.getByTestId('agent-name-input'), 'my-pipeline');
    expect(screen.getByTestId('pipeline-save-button')).toBeDisabled();

    await user.type(screen.getByTestId('agent-description-input'), 'does a thing');
    await waitFor(() => expect(screen.getByTestId('pipeline-save-button')).not.toBeDisabled());
  }, 20_000);

  it('clicking Cancel opens a confirm dialog, and confirming navigates back to /pipelines/:tab', async () => {
    const user = userEvent.setup();
    const { router } = renderPipelinesRoute(<CreatePipeline />, '/pipelines/create', { projectId: '1' });

    await user.click(await screen.findByText('Cancel'));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/pipelines/latest'));
  });

  it('the Save button starts disabled (name/description are required and start empty) and never calls the create endpoint', async () => {
    const createSpy = vi.fn(() => ({
      id: '1',
      name: '',
      description: '',
      type: 'interface',
      icon: '',
      owner_id: 'user-1',
      created_at: '2026-01-01T00:00:00Z',
    }));
    server.use(getCreateApplicationMockHandler(createSpy));
    const { router } = renderPipelinesRoute(<CreatePipeline />, '/pipelines/create', { projectId: '1' });

    const saveButton = await screen.findByTestId('pipeline-save-button');
    await waitFor(() => expect(saveButton).toBeDisabled());

    expect(router.state.location.pathname).toBe('/pipelines/create');
    expect(createSpy).not.toHaveBeenCalled();
  });
});
