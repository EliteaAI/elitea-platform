import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { UserPublicListItem } from '../lib/types';

import { EntityListPanel } from './EntityListPanel';

const BASE_PROPS = {
  emptyTitle: 'Nothing found.',
  errorMessage: 'Something went wrong.',
  loadingMessage: 'Loading…',
  onSelect: () => {},
};

const ITEM: UserPublicListItem = {
  id: 'item-1',
  name: 'My Agent',
  description: 'A helpful agent',
  status: 'published',
  authorNames: ['Ada Lovelace'],
  createdAt: '2026-01-01T00:00:00Z',
  kind: 'agent',
};

describe('EntityListPanel', () => {
  it('shows the loading message while loading', () => {
    const { getByText } = renderWithTheme(
      <EntityListPanel {...BASE_PROPS} items={[]} isLoading isError={false} />,
    );
    expect(getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an alert with the error message on error', () => {
    const { getByRole } = renderWithTheme(
      <EntityListPanel {...BASE_PROPS} items={[]} isLoading={false} isError />,
    );
    expect(getByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('shows the empty-state title when there are no items', () => {
    const { getByText } = renderWithTheme(
      <EntityListPanel {...BASE_PROPS} items={[]} isLoading={false} isError={false} />,
    );
    expect(getByText('Nothing found.')).toBeInTheDocument();
  });

  it('renders each item’s name, description and author names', () => {
    const { getByText } = renderWithTheme(
      <EntityListPanel {...BASE_PROPS} items={[ITEM]} isLoading={false} isError={false} />,
    );
    expect(getByText('My Agent')).toBeInTheDocument();
    expect(getByText('A helpful agent')).toBeInTheDocument();
    expect(getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('omits the description paragraph when the item has none', () => {
    const { queryByText } = renderWithTheme(
      <EntityListPanel {...BASE_PROPS} items={[{ ...ITEM, description: '' }]} isLoading={false} isError={false} />,
    );
    expect(queryByText('A helpful agent')).not.toBeInTheDocument();
  });

  it('renders each card as a real interactive element that calls onSelect with the clicked item', () => {
    const onSelect = vi.fn();
    const { getByText, getByRole } = renderWithTheme(
      <EntityListPanel
        {...BASE_PROPS}
        items={[ITEM]}
        isLoading={false}
        isError={false}
        onSelect={onSelect}
      />,
    );

    // Regression guard for the A12-ui "fully inert cards" finding: the card
    // must be a real, keyboard/screen-reader-reachable button, not inert text.
    expect(getByRole('button', { name: /My Agent/ })).toBeInTheDocument();

    getByText('My Agent').click();
    expect(onSelect).toHaveBeenCalledWith(ITEM);
  });

  it('calls onSelect with each item’s own identity when a list has several kinds', () => {
    const onSelect = vi.fn();
    const pipelineItem: UserPublicListItem = { ...ITEM, id: 'item-2', name: 'My Pipeline', kind: 'pipeline' };
    const { getByText } = renderWithTheme(
      <EntityListPanel
        {...BASE_PROPS}
        items={[ITEM, pipelineItem]}
        isLoading={false}
        isError={false}
        onSelect={onSelect}
      />,
    );

    getByText('My Pipeline').click();
    expect(onSelect).toHaveBeenCalledWith(pipelineItem);
    expect(onSelect).not.toHaveBeenCalledWith(ITEM);
  });
});
