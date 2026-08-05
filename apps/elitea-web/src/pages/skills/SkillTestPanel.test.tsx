import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import {
  correlateSkillTestStream,
  hasSkillTestFinishReason,
  isSkillTestChunkEvent,
  replaceSkillTestAssistant,
  skillTestEventKind,
  skillTestEventType,
  skillTestMessageText,
  skillTestStreamId,
  SkillTestPanel,
} from './SkillTestPanel';
import { renderSkillsRoute } from './__tests__/testRouter';

const BASE = '/api/v2';

beforeEach(() => configureGeneratedClient({ baseUrl: BASE }));
afterEach(() => resetGeneratedClient());

describe('SkillTestPanel', () => {
  it('normalises socket message content, types, and stream correlation', () => {
    expect(skillTestMessageText('text')).toBe('text');
    expect(skillTestMessageText(undefined)).toBe('');
    expect(skillTestMessageText(null)).toBe('');
    expect(skillTestMessageText({ answer: 1 })).toBe('{"answer":1}');
    expect(skillTestEventType({ type: 'chunk' })).toBe('chunk');
    expect(skillTestEventType({ type: 1 })).toBe('');
    expect(skillTestStreamId({ stream_id: 's' })).toBe('s');
    expect(skillTestStreamId({ stream_id: 1 })).toBeUndefined();
    expect(correlateSkillTestStream(undefined, 's')).toEqual({ active: 's', accept: true });
    expect(correlateSkillTestStream('s', 'other')).toEqual({ active: 's', accept: false });
    expect(correlateSkillTestStream('s', undefined)).toEqual({ active: 's', accept: true });
  });

  it('classifies every supported terminal and chunk event', () => {
    expect(isSkillTestChunkEvent('chunk')).toBe(true);
    expect(isSkillTestChunkEvent('AIMessageChunk')).toBe(true);
    expect(isSkillTestChunkEvent('agent_llm_chunk')).toBe(true);
    expect(isSkillTestChunkEvent('other')).toBe(false);
    expect(skillTestEventKind('error')).toBe('error');
    expect(skillTestEventKind('llm_error')).toBe('error');
    expect(skillTestEventKind('agent_response')).toBe('response');
    expect(skillTestEventKind('chunk')).toBe('chunk');
    expect(skillTestEventKind('agent_llm_end')).toBe('end');
    expect(skillTestEventKind('other')).toBe('ignore');
    expect(hasSkillTestFinishReason({ response_metadata: { finish_reason: 'stop' } })).toBe(true);
    expect(hasSkillTestFinishReason({})).toBe(false);
  });

  it('replaces or appends only the targeted assistant message', () => {
    const messages = [
      { id: 'u', role: 'user' as const, content: 'Hello' },
      { id: 'a', role: 'assistant' as const, content: 'A', isLoading: true },
    ];
    expect(replaceSkillTestAssistant(messages, 'a', 'B', true)[1]).toMatchObject({
      content: 'AB',
      isLoading: false,
    });
    expect(replaceSkillTestAssistant(messages, 'a', 'B', false)[1]).toMatchObject({ content: 'B' });
    expect(replaceSkillTestAssistant(messages, 'missing', 'B', false)).toEqual(messages);
  });

  it('requires a model before sending', async () => {
    const user = userEvent.setup();
    renderSkillsRoute(
      <SkillTestPanel
        projectId="project-1"
        instructions="Review carefully"
        skillName="Reviewer"
      />,
    );
    await user.type(await screen.findByPlaceholderText('Type your message…'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('model name');
  });

  it('streams an ephemeral response and can clear it', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/:projectId`, () =>
        HttpResponse.json({ task_id: 'task-1' }),
      ),
    );
    const { socketClient } = renderSkillsRoute(
      <SkillTestPanel
        projectId="project-1"
        instructions="Review carefully"
        skillName="Reviewer"
      />,
    );
    await user.type(await screen.findByLabelText('Model name'), 'gpt');
    await user.type(screen.getByPlaceholderText('Type your message…'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Thinking…')).toBeInTheDocument());
    act(() => {
      socketClient.simulateServerEvent('application_predict', {
        type: 'chunk',
        stream_id: 'backend-stream',
        content: 'Looks good',
        response_metadata: { finish_reason: 'stop' },
      });
    });
    expect(await screen.findByText('Looks good')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Send a message to try these instructions.')).toBeInTheDocument();
  });

  it('renders server errors safely', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/:projectId`, () =>
        HttpResponse.json({ task_id: 'task-1' }),
      ),
    );
    const { socketClient } = renderSkillsRoute(
      <SkillTestPanel
        projectId="project-1"
        instructions="Review carefully"
        skillName="Reviewer"
      />,
    );
    await user.type(await screen.findByLabelText('Model name'), 'gpt');
    await user.type(screen.getByPlaceholderText('Type your message…'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    act(() => {
      socketClient.simulateServerEvent('application_predict', {
        type: 'error',
        stream_id: 'backend-stream',
        content: { error: 'rate limited' },
      });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('rate limited');
  });
});
