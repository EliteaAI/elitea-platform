import type { ReactElement, ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import { installWebStorageShim } from '@/test/webstorage';

import { SimpleLLMInputs, type SimpleLLMInputsProps } from './SimpleLLMInputs';

installCodeMirrorTestPolyfills();
installWebStorageShim();

function renderList(props: SimpleLLMInputsProps): ReturnType<typeof renderWithTheme> {
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
      <SimpleLLMInputs {...props} />
    </Wrapper>,
  );
}

describe('SimpleLLMInputs', () => {
  it('renders one row per inputMappings key', () => {
    const { getByText } = renderList({
      inputMappings: { system: { type: 'fixed' }, task: { type: 'fixed' } },
      values: {},
      defaultValues: {},
      onChangeMapping: vi.fn(),
    });

    expect(getByText('System')).toBeInTheDocument();
    expect(getByText('Task')).toBeInTheDocument();
  });

  it('prefers the current `values` entry over `inputMappings` and `defaultValues`', () => {
    const { getByLabelText } = renderList({
      inputMappings: { system: { type: 'fixed', value: 'from-mapping' } },
      values: { system: { type: 'fixed', value: 'from-values' } },
      defaultValues: { system: 'from-default' },
      onChangeMapping: vi.fn(),
    });

    expect(getByLabelText('Value')).toHaveValue('from-values');
  });

  it('falls back to defaultValues when neither values nor inputMappings carry a value', () => {
    const { getByLabelText } = renderList({
      inputMappings: { system: { type: 'fixed' } },
      values: {},
      defaultValues: { system: 'the-default' },
      onChangeMapping: vi.fn(),
    });

    expect(getByLabelText('Value')).toHaveValue('the-default');
  });

  it('renders nothing for an empty inputMappings map', () => {
    const { container } = renderList({ inputMappings: {}, values: {}, defaultValues: {}, onChangeMapping: vi.fn() });
    expect(container.querySelectorAll('[data-testid]').length).toBe(0);
  });
});
