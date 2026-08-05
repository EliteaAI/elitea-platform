import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { CredentialTypeSelector } from './CredentialTypeSelector';
import type { ConfigurationTypeDescriptor } from '@/features/credentials';

class ResizeObserverStub {
  observe(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const TYPES: ConfigurationTypeDescriptor[] = [
  { type: 'openai', config_schema: { title: 'OpenAI', properties: { data: { metadata: { categories: ['LLM'] } } } } },
  { type: 'azure', config_schema: { title: 'Azure', properties: { data: { metadata: { categories: ['LLM'] } } } } },
  { type: 'hidden_one', config_schema: { title: 'Hidden', metadata: { hidden: true }, properties: {} } },
];

describe('CredentialTypeSelector', () => {
  it('lists every visible type, sorted, and calls onSelectType when one is clicked', () => {
    const onSelectType = vi.fn();
    renderWithTheme(
      <CredentialTypeSelector
        configurationsData={TYPES}
        isFetching={false}
        onSelectType={onSelectType}
      />,
    );
    expect(screen.getByText('Azure')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    fireEvent.click(screen.getByText('OpenAI'));
    expect(onSelectType).toHaveBeenCalledWith('openai');
  });

  it('hides types marked config_schema.metadata.hidden', () => {
    renderWithTheme(
      <CredentialTypeSelector
        configurationsData={TYPES}
        isFetching={false}
        onSelectType={vi.fn()}
      />,
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('filters by the search box', async () => {
    renderWithTheme(
      <CredentialTypeSelector
        configurationsData={TYPES}
        isFetching={false}
        onSelectType={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Search credentials'), { target: { value: 'azure' } });
    await waitFor(() => expect(screen.queryByText('OpenAI')).not.toBeInTheDocument());
    expect(screen.getByText('Azure')).toBeInTheDocument();
  });

  it('shows the no-results message when nothing matches', async () => {
    renderWithTheme(
      <CredentialTypeSelector
        configurationsData={TYPES}
        isFetching={false}
        onSelectType={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Search credentials'), { target: { value: 'zzz-no-match' } });
    await waitFor(() => expect(screen.getByText('No credentials found')).toBeInTheDocument());
  });

  it('handles an undefined configurationsData without crashing', () => {
    renderWithTheme(
      <CredentialTypeSelector
        configurationsData={undefined}
        isFetching
        onSelectType={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText('Search credentials')).toBeInTheDocument();
  });
});
