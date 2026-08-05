import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { PipelineListPanel, type PipelineListRow } from './PipelineListPanel';

const BASE_PROPS = {
  emptyTitle: 'Nothing found.',
  emptyDescription: 'Try a different search.',
  errorMessage: 'Something went wrong.',
  onSelect: () => {},
  hasMore: false,
  isLoadingMore: false,
  onLoadMore: () => {},
};

const ROWS: readonly PipelineListRow[] = [
  { id: '1', name: 'My Pipeline', description: 'A helpful pipeline' },
  { id: '2', name: 'Other Pipeline', description: 'Another pipeline' },
];

describe('PipelineListPanel', () => {
  it('shows a loading message while loading', () => {
    const { getByText } = renderWithTheme(
      <PipelineListPanel
        {...BASE_PROPS}
        rows={[]}
        isLoading
        isError={false}
      />,
    );
    expect(getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an alert with the error message on error', () => {
    const { getByRole } = renderWithTheme(
      <PipelineListPanel
        {...BASE_PROPS}
        rows={[]}
        isLoading={false}
        isError
      />,
    );
    expect(getByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('shows the empty state when there are no rows', () => {
    const { getByText } = renderWithTheme(
      <PipelineListPanel
        {...BASE_PROPS}
        rows={[]}
        isLoading={false}
        isError={false}
      />,
    );
    expect(getByText('Nothing found.')).toBeInTheDocument();
  });

  it('renders each row and calls onSelect with its id when clicked', () => {
    const onSelect = vi.fn();
    const { getByText } = renderWithTheme(
      <PipelineListPanel
        {...BASE_PROPS}
        rows={ROWS}
        isLoading={false}
        isError={false}
        onSelect={onSelect}
      />,
    );
    expect(getByText('My Pipeline')).toBeInTheDocument();
    expect(getByText('Another pipeline')).toBeInTheDocument();

    getByText('My Pipeline').click();
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('does not render "Load more" when hasMore is false', () => {
    const { queryByText } = renderWithTheme(
      <PipelineListPanel
        {...BASE_PROPS}
        rows={ROWS}
        isLoading={false}
        isError={false}
        hasMore={false}
      />,
    );
    expect(queryByText('Load more')).not.toBeInTheDocument();
  });

  it('renders "Load more" and calls onLoadMore when hasMore is true', () => {
    const onLoadMore = vi.fn();
    const { getByText } = renderWithTheme(
      <PipelineListPanel
        {...BASE_PROPS}
        rows={ROWS}
        isLoading={false}
        isError={false}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );
    getByText('Load more').click();
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('disables "Load more" while isLoadingMore is true', () => {
    const { getByText } = renderWithTheme(
      <PipelineListPanel
        {...BASE_PROPS}
        rows={ROWS}
        isLoading={false}
        isError={false}
        hasMore
        isLoadingMore
      />,
    );
    expect(getByText('Load more').closest('button')).toBeDisabled();
  });
});
