import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { IndexRow } from '../../model/indexesStore';

import { IndexListItem } from './IndexListItem';

describe('IndexListItem', () => {
  it('renders a loading skeleton when useMock is set', () => {
    const { getAllByTestId } = renderWithTheme(
      <IndexListItem
        useMock
        index={{ id: 'skel', metadata: {} }}
      />,
    );
    expect(getAllByTestId('index-list-item-skeleton')).toHaveLength(2);
  });

  it('shows the collection name and total-indexed count', () => {
    const index: IndexRow = { id: '1', metadata: { collection: 'my-index', indexed: 42 } };
    const { getByText } = renderWithTheme(<IndexListItem index={index} />);
    expect(getByText('my-index')).toBeInTheDocument();
    expect(getByText('42')).toBeInTheDocument();
  });

  it('shows "reindexed / total indexed" once history has more than one entry', () => {
    const index: IndexRow = { id: '1', metadata: { collection: 'my-index', indexed: 42, updated: 5, history: [{}, {}] } };
    const { getByText } = renderWithTheme(<IndexListItem index={index} />);
    expect(getByText('5 / 42')).toBeInTheDocument();
  });

  it('shows a skipped-count badge when documents were skipped', () => {
    const index: IndexRow = { id: '1', metadata: { collection: 'my-index', indexed: 10, skipped: { total_skipped: 3 } } };
    const { getByText } = renderWithTheme(<IndexListItem index={index} />);
    expect(getByText('3')).toBeInTheDocument();
  });

  it('calls onIndexClick with the index when clicked', async () => {
    const user = userEvent.setup();
    const onIndexClick = vi.fn();
    const index: IndexRow = { id: '1', metadata: { collection: 'my-index' } };
    const { getByText } = renderWithTheme(
      <IndexListItem
        index={index}
        onIndexClick={onIndexClick}
      />,
    );
    await user.click(getByText('my-index'));
    expect(onIndexClick).toHaveBeenCalledWith(index);
  });
});
