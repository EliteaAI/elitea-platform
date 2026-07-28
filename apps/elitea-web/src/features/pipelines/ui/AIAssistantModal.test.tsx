import type { ReactElement, ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server } from '../../../test/setup';
import { installWebStorageShim } from '../../../test/webstorage';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

import { AIAssistantModal } from './AIAssistantModal';
import type { AIAssistantModalProps } from './AIAssistantModal';

installCodeMirrorTestPolyfills();
installWebStorageShim();

const BASE = '/api/v2';

function stubConfigurationsEndpoints(): void {
  server.use(
    http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([])),
    http.get(`${BASE}/configurations/configurations/7`, () => HttpResponse.json({ items: [], total: 0 })),
  );
}

function renderModal(props: AIAssistantModalProps, client: TestSocketClient = createTestSocketClient()): ReturnType<typeof renderWithTheme> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <SocketClientContext.Provider value={client}>{children as ReactElement}</SocketClientContext.Provider>
      </QueryClientProvider>
    );
  }
  return renderWithTheme(
    <Wrapper>
      <AIAssistantModal {...props} />
    </Wrapper>,
  );
}

afterEach(() => {
  resetGeneratedClient();
});

describe('AIAssistantModal', () => {
  it('renders the capitalized title and the initial value', () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const { getByText } = renderModal({
      open: true,
      value: 'the current content',
      title: 'system',
      projectId: 7,
      modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 },
    });

    expect(getByText('System')).toBeInTheDocument();
    expect(getByText('the current content')).toBeInTheDocument();
  });

  it('renders the AI prompt input footer', () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const { getByPlaceholderText } = renderModal({ open: true, value: '', title: 'task', projectId: 7 });
    expect(getByPlaceholderText('Describe your idea to generate or rewrite the value.')).toBeInTheDocument();
  });

  it('commits the current value via onChange on close when hasOnChangeCallback is set', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const onChange = vi.fn();
    const onClose = vi.fn();
    const { getByLabelText } = renderModal({
      open: true,
      value: 'abc',
      title: 'task',
      projectId: 7,
      onClose,
      fieldBinding: { hasOnChangeCallback: true, onChange, name: 'task', id: 'field-1' },
    });

    await userEvent.click(getByLabelText('Close'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const event = onChange.mock.calls[0]?.[0] as { target: { value: string; name?: string; id?: string } };
    expect(event.target).toEqual({ value: 'abc', name: 'task', id: 'field-1' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onInput (not onChange) on close when hasOnChangeCallback is not set', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const onChange = vi.fn();
    const onInput = vi.fn();
    const { getByLabelText } = renderModal({
      open: true,
      value: 'abc',
      title: 'task',
      projectId: 7,
      onClose: vi.fn(),
      fieldBinding: { onChange, onInput },
    });

    await userEvent.click(getByLabelText('Close'));

    expect(onChange).not.toHaveBeenCalled();
    expect(onInput).toHaveBeenCalledTimes(1);
    const event = onInput.mock.calls[0]?.[0] as { target: { value: string } };
    expect(event.target.value).toBe('abc');
  });

  it('shows an error banner when the hook surfaces errorMessage (no model configured)', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const { getByPlaceholderText, findByText } = renderModal({
      open: true,
      value: '',
      title: 'system',
      projectId: 7,
      modelConfig: null,
    });

    await userEvent.type(getByPlaceholderText('Describe your idea to generate or rewrite the value.'), 'go{Enter}');

    expect(await findByText('No LLM model configured. Please configure a model in the pipeline settings.')).toBeInTheDocument();
  });

  describe('split-view generation flow (real streamed generation via the socket)', () => {
    function stubPredictEndpoint(): { getStreamId: () => string | undefined } {
      let capturedBody: { stream_id?: string } = {};
      server.use(
        http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/7`, async ({ request }) => {
          capturedBody = (await request.json()) as { stream_id?: string };
          return HttpResponse.json({});
        }),
      );
      return { getStreamId: () => capturedBody.stream_id };
    }

    it('entering a prompt with existing non-empty content opens the split view (Apply/Discard become available) once generation completes', async () => {
      configureGeneratedClient({ baseUrl: BASE });
      stubConfigurationsEndpoints();
      const { getStreamId } = stubPredictEndpoint();
      const client = createTestSocketClient();
      const user = userEvent.setup();

      const { getByPlaceholderText, findByRole } = renderModal(
        {
          open: true,
          value: 'the current content',
          title: 'system',
          projectId: 7,
          modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 },
        },
        client,
      );

      await user.type(getByPlaceholderText('Describe your idea to generate or rewrite the value.'), 'improve this{Enter}');

      await waitFor(() => expect(getStreamId()).toBeDefined());
      const streamId = getStreamId();

      act(() => {
        client.simulateServerEvent('application_predict', { type: 'chunk', stream_id: streamId, content: 'better content' });
        client.simulateServerEvent('application_predict', {
          type: 'chunk',
          stream_id: streamId,
          content: '',
          response_metadata: { finish_reason: 'stop' },
        });
      });

      expect(await findByRole('button', { name: 'Apply' })).toBeInTheDocument();
      expect(await findByRole('button', { name: 'Close split view' })).toBeInTheDocument();
    });

    it('Apply commits the improved content via onChange and closes the split view', async () => {
      configureGeneratedClient({ baseUrl: BASE });
      stubConfigurationsEndpoints();
      const { getStreamId } = stubPredictEndpoint();
      const client = createTestSocketClient();
      const user = userEvent.setup();
      const onChange = vi.fn();

      const { getByPlaceholderText, findByRole, queryByRole } = renderModal(
        {
          open: true,
          value: 'the current content',
          title: 'system',
          projectId: 7,
          modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 },
          fieldBinding: { hasOnChangeCallback: true, onChange, name: 'system' },
        },
        client,
      );

      await user.type(getByPlaceholderText('Describe your idea to generate or rewrite the value.'), 'improve this{Enter}');
      await waitFor(() => expect(getStreamId()).toBeDefined());
      const streamId = getStreamId();

      act(() => {
        client.simulateServerEvent('application_predict', { type: 'chunk', stream_id: streamId, content: 'better content' });
        client.simulateServerEvent('application_predict', {
          type: 'chunk',
          stream_id: streamId,
          content: '',
          response_metadata: { finish_reason: 'stop' },
        });
      });

      await user.click(await findByRole('button', { name: 'Apply' }));

      const call = onChange.mock.calls[0]?.[0] as { target: { value: string } };
      expect(call.target.value).toBe('better content');
      await waitFor(() => expect(queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument());
    });

    it('the split view close ("Discard") button closes without applying the generated content', async () => {
      configureGeneratedClient({ baseUrl: BASE });
      stubConfigurationsEndpoints();
      const { getStreamId } = stubPredictEndpoint();
      const client = createTestSocketClient();
      const user = userEvent.setup();
      const onChange = vi.fn();

      const { getByPlaceholderText, findByRole, queryByRole } = renderModal(
        {
          open: true,
          value: 'the current content',
          title: 'system',
          projectId: 7,
          modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 },
          fieldBinding: { hasOnChangeCallback: true, onChange, name: 'system' },
        },
        client,
      );

      await user.type(getByPlaceholderText('Describe your idea to generate or rewrite the value.'), 'improve this{Enter}');
      await waitFor(() => expect(getStreamId()).toBeDefined());
      const streamId = getStreamId();

      act(() => {
        client.simulateServerEvent('application_predict', { type: 'chunk', stream_id: streamId, content: 'better content' });
        client.simulateServerEvent('application_predict', {
          type: 'chunk',
          stream_id: streamId,
          content: '',
          response_metadata: { finish_reason: 'stop' },
        });
      });

      await user.click(await findByRole('button', { name: 'Close split view' }));

      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() => expect(queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument());
    });

    it('starting from error content clears the field and generates fresh (single view, not split)', async () => {
      configureGeneratedClient({ baseUrl: BASE });
      stubConfigurationsEndpoints();
      const { getStreamId } = stubPredictEndpoint();
      const client = createTestSocketClient();
      const user = userEvent.setup();

      const { getByPlaceholderText, findByText, queryByRole } = renderModal(
        {
          open: true,
          value: 'Error: something went wrong before',
          title: 'system',
          projectId: 7,
          modelConfig: { model_name: 'gpt-4', temperature: 0.7, max_tokens: 100 },
        },
        client,
      );

      await user.type(getByPlaceholderText('Describe your idea to generate or rewrite the value.'), 'retry{Enter}');
      await waitFor(() => expect(getStreamId()).toBeDefined());
      const streamId = getStreamId();

      act(() => {
        client.simulateServerEvent('application_predict', { type: 'chunk', stream_id: streamId, content: 'fresh content' });
        client.simulateServerEvent('application_predict', {
          type: 'chunk',
          stream_id: streamId,
          content: '',
          response_metadata: { finish_reason: 'stop' },
        });
      });

      expect(await findByText('fresh content')).toBeInTheDocument();
      // Single-view (not split) — no Apply/Discard controls.
      expect(queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    });
  });
});
