import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { ChatMessage } from '../../lib/convertMessagesToChatHistory';
import { ApplicationAnswer } from './ApplicationAnswer';

describe('ApplicationAnswer', () => {
  it('renders durable partial content with its terminal error', () => {
    const answer = {
      id: 'answer-1',
      role: 'assistant',
      content: 'The response reached this durable point.',
      exception: 'The runtime operation failed.',
    } as ChatMessage;

    renderWithTheme(<ApplicationAnswer answer={answer} messageId={answer.id} />);

    expect(screen.getByText('The response reached this durable point.')).toBeInTheDocument();
    expect(screen.getByText('The runtime operation failed.')).toBeInTheDocument();
  });

  it('renders a refusal that arrived before any content', () => {
    // The shape `recordStreamFailure` appends when a run is refused before it
    // streams anything (`lib/chatStreamSettle.ts`): no content, no tool
    // actions, only the reason. Nothing else on the row would be visible, so
    // if the exception did not render the turn would look like a lost message
    // — which is exactly what a live stack showed.
    const answer = {
      id: 'answer-2',
      role: 'assistant',
      content: '',
      exception: 'Configuration type is not supported.',
      isStreaming: false,
      isLoading: false,
    } as ChatMessage;

    renderWithTheme(<ApplicationAnswer answer={answer} messageId={answer.id} />);

    expect(screen.getByTestId('error-trace')).toBeInTheDocument();
    expect(screen.getByText('Configuration type is not supported.')).toBeInTheDocument();
  });

  it('renders every authorization request and resumes only after OAuth succeeds', () => {
    const onContinue = vi.fn();
    const action = (id: string) => ({
      id,
      authorizationRequestId: id,
      type: 'toolkit',
      status: 'action_required',
      toolMeta: { interrupt_id: id, authorization_servers: ['https://login.example.test'] },
      toolOutputs: { server_url: 'https://mcp.example.test' },
    });
    const answer = {
      id: 'answer-auth',
      role: 'assistant',
      content: '',
      toolActions: [action('auth-1'), action('auth-2')],
    } as unknown as ChatMessage;

    renderWithTheme(<ApplicationAnswer
      answer={answer}
      messageId={answer.id}
      toolActions={answer.toolActions}
      continuation={{
        onContinueMcpExecution: onContinue,
        renderAuthModal: (props) => <button onClick={() => { props.onClose(true); }}>Complete OAuth</button>,
      }}
    />);

    expect(screen.getAllByRole('button', { name: 'Continue (Auth)' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Continue (Auth)' })[0]!);
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Complete OAuth' }));
    expect(onContinue).toHaveBeenCalledWith('answer-auth', false, 'auth-1');
  });
});
