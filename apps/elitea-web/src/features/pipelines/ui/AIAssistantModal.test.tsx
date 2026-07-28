import type { ReactElement, ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
});
