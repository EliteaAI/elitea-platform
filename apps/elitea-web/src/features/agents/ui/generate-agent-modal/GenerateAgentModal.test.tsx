import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCreateApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import type { PredictResponse } from '@/shared/api/generated/model';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { server } from '@/test/setup';

import { GenerateAgentModal, type GenerateAgentModalProps } from './GenerateAgentModal';

/**
 * NOTE(#126): orval's `getGenerateAgentDraftMockHandler` disappeared when the
 * `generateAgentDraft` operation was removed from `api/openapi/v2.yaml` — its
 * route was gated on a `RouterConfig.Predictor` nothing ever assigned and
 * answered 404 in every deployment. This local factory stands in for it and
 * matches the same URL and response shape, so the assertions below are
 * unchanged.
 */
function generateAgentDraftHandler(body?: PredictResponse) {
  return http.post('*/elitea_core/generate_application_draft/prompt_lib/:projectId', () =>
    HttpResponse.json(body ?? { message_group_uid: 'mg-default', content: 'draft', is_streaming: false }),
  );
}


function renderModal(overrides: Partial<GenerateAgentModalProps> = {}): ReturnType<typeof renderWithTheme> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const props: GenerateAgentModalProps = {
    open: true,
    onClose: vi.fn(),
    projectId: 'p1',
    onAgentCreated: vi.fn(),
    ...overrides,
  };
  return renderWithTheme((<QueryClientProvider client={queryClient}><GenerateAgentModal {...props} /></QueryClientProvider>) as ReactElement);
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('GenerateAgentModal', () => {
  it('disables Generate until a description is typed', () => {
    renderModal();
    expect(screen.getByText('Generate').closest('button')).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Describe your agent/), { target: { value: 'A support bot' } });
    expect(screen.getByText('Generate').closest('button')).not.toBeDisabled();
  });

  it('generates a draft and transitions to the review step, seeding instructions from the response content', async () => {
    server.use(generateAgentDraftHandler({ message_group_uid: 'm1', content: 'Answer support questions.', is_streaming: false }));
    renderModal();

    fireEvent.change(screen.getByPlaceholderText(/Describe your agent/), { target: { value: 'A support bot' } });
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => expect(screen.getByDisplayValue('Answer support questions.')).toBeInTheDocument());
    expect(screen.getByText('Create Agent')).toBeInTheDocument();
  });

  it('shows an inline error and stays on the input step when generation fails', async () => {
    server.use(
      http.post('*/elitea_core/generate_application_draft/prompt_lib/:projectId', () =>
        HttpResponse.json({ error: 'model unavailable' }, { status: 500 }),
      ),
    );
    renderModal();

    fireEvent.change(screen.getByPlaceholderText(/Describe your agent/), { target: { value: 'A support bot' } });
    fireEvent.click(screen.getByText('Generate'));

    // `applicationErrorMessage` (a landed sibling file) surfaces `EliteaApiError.message`
    // — a generic "eliteaFetch: STATUS from URL" string, never the JSON body's `error`
    // field (see that file's own doc comment) — so the inline alert shows that shape,
    // not the raw backend error text.
    await waitFor(() => expect(screen.getByText(/eliteaFetch: 500/)).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/Describe your agent/)).toBeInTheDocument();
  });

  it('going back to the prompt clears the draft', async () => {
    server.use(generateAgentDraftHandler({ message_group_uid: 'm1', content: 'Draft text', is_streaming: false }));
    renderModal();

    fireEvent.change(screen.getByPlaceholderText(/Describe your agent/), { target: { value: 'A support bot' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getByText('Back to prompt')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Back to prompt'));

    expect(screen.getByPlaceholderText(/Describe your agent/)).toBeInTheDocument();
  });

  it('creates the agent and calls onAgentCreated on approve', async () => {
    server.use(
      generateAgentDraftHandler({ message_group_uid: 'm1', content: 'Draft text', is_streaming: false }),
      getCreateApplicationMockHandler({
        id: '42',
        name: 'New Agent',
        description: '',
        type: 'interface',
        icon: '',
        owner_id: 'u1',
        created_at: '2026-01-01T00:00:00Z',
      }),
    );
    const onAgentCreated = vi.fn();
    const onClose = vi.fn();
    renderModal({ onAgentCreated, onClose });

    fireEvent.change(screen.getByPlaceholderText(/Describe your agent/), { target: { value: 'A support bot' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getByText('Create Agent')).toBeInTheDocument());

    // Both `name` and `description` are required by `validateAgentDraft` — the generated
    // draft only ever seeds `instructions` (see `mapPredictResponseToAgentDraft`'s own doc
    // comment), so both must be filled in before "Create Agent" becomes clickable.
    fireEvent.change(screen.getByTestId('agent-draft-name-input'), { target: { value: 'New Agent' } });
    fireEvent.change(screen.getByTestId('agent-draft-description-input'), { target: { value: 'A helpful agent' } });
    await waitFor(() => expect(screen.getByText('Create Agent').closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Create Agent'));

    await waitFor(() => expect(onAgentCreated).toHaveBeenCalledWith(expect.objectContaining({ id: '42', name: 'New Agent' })));
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a failed approve via onApproveError instead of throwing', async () => {
    server.use(
      generateAgentDraftHandler({ message_group_uid: 'm1', content: 'Draft text', is_streaming: false }),
      http.post('*/elitea_core/applications/prompt_lib/:projectId', () =>
        HttpResponse.json({ error: 'create failed' }, { status: 500 }),
      ),
    );
    const onApproveError = vi.fn();
    renderModal({ onApproveError });

    fireEvent.change(screen.getByPlaceholderText(/Describe your agent/), { target: { value: 'A support bot' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getByText('Create Agent')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('agent-draft-name-input'), { target: { value: 'New Agent' } });
    fireEvent.change(screen.getByTestId('agent-draft-description-input'), { target: { value: 'A helpful agent' } });
    await waitFor(() => expect(screen.getByText('Create Agent').closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Create Agent'));

    // `useAgentDraftApproval.approve` swallows `useCreateApplicationDraft`'s own caught
    // error (it sets `.error` state rather than rejecting) and throws its own literal
    // "Failed to create the agent." instead — see `useAgentDraftApproval.ts`'s `approve`.
    await waitFor(() => expect(onApproveError).toHaveBeenCalledWith('Failed to create the agent.'));
  });

  it('disables Create Agent while the draft is invalid (blank name)', async () => {
    server.use(generateAgentDraftHandler({ message_group_uid: 'm1', content: 'Draft text', is_streaming: false }));
    renderModal();

    fireEvent.change(screen.getByPlaceholderText(/Describe your agent/), { target: { value: 'A support bot' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getByText('Create Agent')).toBeInTheDocument());

    // `isDraftValid` starts `true` and only flips once `GenerateAgentReviewForm`'s own
    // validation effect runs post-mount — wait for it rather than asserting synchronously.
    await waitFor(() => expect(screen.getByText('Create Agent').closest('button')).toBeDisabled());
  });

  it('autofocuses the description field when the modal opens', () => {
    renderModal();
    expect(screen.getByPlaceholderText(/Describe your agent/)).toHaveFocus();
  });

  it('pressing Enter in the description field triggers Generate', async () => {
    server.use(generateAgentDraftHandler({ message_group_uid: 'm1', content: 'From Enter', is_streaming: false }));
    renderModal();

    const textarea = screen.getByPlaceholderText(/Describe your agent/);
    fireEvent.change(textarea, { target: { value: 'A support bot' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(screen.getByDisplayValue('From Enter')).toBeInTheDocument());
  });

  it('Shift+Enter in the description field inserts a newline instead of triggering Generate', () => {
    renderModal();

    const textarea = screen.getByPlaceholderText(/Describe your agent/);
    fireEvent.change(textarea, { target: { value: 'A support bot' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(screen.queryByText(/Generating agent draft/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Describe your agent/)).toBeInTheDocument();
  });

  it('closing the modal while a generate request is in flight discards the response instead of reopening into a stale review step', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    let resolveResponse: (() => void) | undefined;
    const responseGate = new Promise<void>((resolve) => {
      resolveResponse = resolve;
    });
    server.use(
      http.post('*/elitea_core/generate_application_draft/prompt_lib/:projectId', async () => {
        await responseGate;
        return HttpResponse.json({ message_group_uid: 'm1', content: 'Stale draft text', is_streaming: false });
      }),
    );

    const onClose = vi.fn();
    const props: GenerateAgentModalProps = { open: true, onClose, projectId: 'p1', onAgentCreated: vi.fn() };
    const { rerender } = renderWithTheme(
      (<QueryClientProvider client={queryClient}><GenerateAgentModal {...props} /></QueryClientProvider>) as ReactElement,
    );

    fireEvent.change(screen.getByPlaceholderText(/Describe your agent/), { target: { value: 'A support bot' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getByText(/Generating agent draft/)).toBeInTheDocument());

    // Close mid-flight — the X button, Escape, and backdrop all wire to the same `handleClose`.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Simulate the parent (`GenerateAgentButton`) reacting to `onClose` by hiding the dialog.
    rerender(
      (<QueryClientProvider client={queryClient}><GenerateAgentModal {...props} open={false} /></QueryClientProvider>) as ReactElement,
    );

    // Let the in-flight request resolve only now, after close.
    resolveResponse?.();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    // Reopen — must land on a fresh input step, not the stale review step with the
    // just-arrived (unrequested-by-then) draft content.
    rerender(
      (<QueryClientProvider client={queryClient}><GenerateAgentModal {...props} open /></QueryClientProvider>) as ReactElement,
    );

    expect(screen.getByPlaceholderText(/Describe your agent/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Stale draft text')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Agent')).not.toBeInTheDocument();
  });
});
