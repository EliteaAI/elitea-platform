import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { UserPublicListItem } from '../lib/types';

import { EntityListPanel } from './EntityListPanel';

const BASE_PROPS = {
  emptyTitle: 'Nothing found.',
  errorMessage: 'Something went wrong.',
  loadingMessage: 'Loading…',
};

const ITEM: UserPublicListItem = {
  id: 'item-1',
  name: 'My Agent',
  description: 'A helpful agent',
  status: 'published',
  authorNames: ['Ada Lovelace'],
  createdAt: '2026-01-01T00:00:00Z',
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
});
