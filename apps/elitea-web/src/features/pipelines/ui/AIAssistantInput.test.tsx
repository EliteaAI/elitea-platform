import type { ReactElement, ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../../../test/setup';
import { installWebStorageShim } from '../../../test/webstorage';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';

import { AIAssistantInput } from './AIAssistantInput';
import type { AIAssistantInputProps } from './AIAssistantInput';

installCodeMirrorTestPolyfills();
installWebStorageShim();

const BASE = '/api/v2';

function stubConfigurationsEndpoints(): void {
  server.use(
    http.get(`${BASE}/configurations/available/`, () => HttpResponse.json([])),
    http.get(`${BASE}/configurations/configurations/7`, () => HttpResponse.json({ items: [], total: 0 })),
  );
}

function renderInput(props: AIAssistantInputProps): ReturnType<typeof renderWithTheme> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createTestSocketClient();
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <SocketClientContext.Provider value={client}>{children as ReactElement}</SocketClientContext.Provider>
      </QueryClientProvider>
    );
  }
  return renderWithTheme(
    <Wrapper>
      <AIAssistantInput {...props} />
    </Wrapper>,
  );
}

afterEach(() => {
  resetGeneratedClient();
});

describe('AIAssistantInput', () => {
  it('renders the value inside an InputBase and no modal until opened', () => {
    const { getByDisplayValue, queryByPlaceholderText } = renderInput({ value: 'draft prompt' });
    expect(getByDisplayValue('draft prompt')).toBeInTheDocument();
    expect(queryByPlaceholderText('Describe your idea to generate or rewrite the value.')).toBeNull();
  });

  it('opens the AIAssistantModal when the trigger button is clicked', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const ui = renderInput({ value: 'draft prompt', fieldName: 'system', projectId: 7 });

    await userEvent.click(ui.getByRole('button', { name: 'AI Assistant' }));

    expect(ui.getByPlaceholderText('Describe your idea to generate or rewrite the value.')).toBeInTheDocument();
  });

  it('closes the modal via its close button', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    stubConfigurationsEndpoints();
    const ui = renderInput({ value: 'draft prompt', fieldName: 'system', projectId: 7 });

    await userEvent.click(ui.getByRole('button', { name: 'AI Assistant' }));
    expect(ui.getByPlaceholderText('Describe your idea to generate or rewrite the value.')).toBeInTheDocument();

    await userEvent.click(ui.getByLabelText('Close'));
    expect(ui.queryByPlaceholderText('Describe your idea to generate or rewrite the value.')).toBeNull();
  });
});
