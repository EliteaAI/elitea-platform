import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { IndexRow } from '../../model/indexesStore';

import { IndexesList } from './IndexesList';

const indexes: IndexRow[] = [
  { id: '1', metadata: { collection: 'a' } },
  { id: '2', metadata: { collection: 'b' } },
];

describe('IndexesList', () => {
  it('shows the empty placeholder when there are no indexes and it is not loading', () => {
    const { getByText } = renderWithTheme(
      <IndexesList
        handleAddIndex={vi.fn()}
        indexesList={[]}
        onIndexClick={vi.fn()}
        loading={false}
      />,
    );
    expect(getByText('Still no indexes created')).toBeInTheDocument();
  });

  it('renders skeleton rows while loading', () => {
    const { getAllByTestId } = renderWithTheme(
      <IndexesList
        handleAddIndex={vi.fn()}
        indexesList={[]}
        onIndexClick={vi.fn()}
        loading
      />,
    );
    expect(getAllByTestId('index-list-item-skeleton')).toHaveLength(8);
  });

  it('renders every index row', () => {
    const { getByText } = renderWithTheme(
      <IndexesList
        handleAddIndex={vi.fn()}
        indexesList={indexes}
        onIndexClick={vi.fn()}
      />,
    );
    expect(getByText('a')).toBeInTheDocument();
    expect(getByText('b')).toBeInTheDocument();
  });

  it('calls handleAddIndex when the add button is clicked', async () => {
    const user = userEvent.setup();
    const handleAddIndex = vi.fn();
    const { getByRole } = renderWithTheme(
      <IndexesList
        handleAddIndex={handleAddIndex}
        indexesList={[]}
        onIndexClick={vi.fn()}
      />,
    );
    await user.click(getByRole('button', { name: 'Add index' }));
    expect(handleAddIndex).toHaveBeenCalled();
  });
});
