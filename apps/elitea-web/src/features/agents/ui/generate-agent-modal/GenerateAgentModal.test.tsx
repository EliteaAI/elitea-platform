import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCreateApplicationMockHandler,
  getGenerateAgentDraftMockHandler,
} from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { server } from '@/test/setup';

import { GenerateAgentModal, type GenerateAgentModalProps } from './GenerateAgentModal';

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
    server.use(getGenerateAgentDraftMockHandler({ message_group_uid: 'm1', content: 'Answer support questions.', is_streaming: false }));
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
    server.use(getGenerateAgentDraftMockHandler({ message_group_uid: 'm1', content: 'Draft text', is_streaming: false }));
    renderModal();

    fireEvent.change(screen.getByPlaceholderText(/Describe your agent/), { target: { value: 'A support bot' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getByText('Back to prompt')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Back to prompt'));

    expect(screen.getByPlaceholderText(/Describe your agent/)).toBeInTheDocument();
  });

  it('creates the agent and calls onAgentCreated on approve', async () => {
    server.use(
      getGenerateAgentDraftMockHandler({ message_group_uid: 'm1', content: 'Draft text', is_streaming: false }),
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
      getGenerateAgentDraftMockHandler({ message_group_uid: 'm1', content: 'Draft text', is_streaming: false }),
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
    server.use(getGenerateAgentDraftMockHandler({ message_group_uid: 'm1', content: 'Draft text', is_streaming: false }));
    renderModal();

    fireEvent.change(screen.getByPlaceholderText(/Describe your agent/), { target: { value: 'A support bot' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getByText('Create Agent')).toBeInTheDocument());

    // `isDraftValid` starts `true` and only flips once `GenerateAgentReviewForm`'s own
    // validation effect runs post-mount — wait for it rather than asserting synchronously.
    await waitFor(() => expect(screen.getByText('Create Agent').closest('button')).toBeDisabled());
  });
});
