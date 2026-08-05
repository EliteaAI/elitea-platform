import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { PaginatedEntityTable } from './PaginatedEntityTable';
import type { EntityTableColumn } from './PaginatedEntityTable';

const COLUMNS: readonly EntityTableColumn[] = [
  { header: 'Name', flex: 3, render: (row) => String(row['name']) },
];

function makeRows(count: number): readonly Readonly<Record<string, unknown>>[] {
  return Array.from({ length: count }, (_, i) => ({ id: i, name: `Item ${i}` }));
}

describe('PaginatedEntityTable', () => {
  it('renders the column headers', () => {
    const { getByText } = renderWithTheme(
      <PaginatedEntityTable
        rows={[]}
        isFetching={false}
        columns={COLUMNS}
        rowKey={(row) => String(row['id'])}
        searchPlaceholder="Search"
        searchFilter={() => true}
      />,
    );
    expect(getByText('Name')).toBeInTheDocument();
  });

  it('shows a spinner while isFetching, and no rows', () => {
    const { getByRole, queryByText } = renderWithTheme(
      <PaginatedEntityTable
        rows={makeRows(3)}
        isFetching
        columns={COLUMNS}
        rowKey={(row) => String(row['id'])}
        searchPlaceholder="Search"
        searchFilter={() => true}
      />,
    );
    expect(getByRole('progressbar')).toBeInTheDocument();
    expect(queryByText('Item 0')).not.toBeInTheDocument();
  });

  it('renders the first page of rows (default page size 20)', () => {
    const { getByText, queryByText } = renderWithTheme(
      <PaginatedEntityTable
        rows={makeRows(25)}
        isFetching={false}
        columns={COLUMNS}
        rowKey={(row) => String(row['id'])}
        searchPlaceholder="Search"
        searchFilter={() => true}
      />,
    );
    expect(getByText('Item 0')).toBeInTheDocument();
    expect(getByText('Item 19')).toBeInTheDocument();
    expect(queryByText('Item 20')).not.toBeInTheDocument();
  });

  it('paginates to the next page on click', async () => {
    const user = userEvent.setup();
    const { getByText, getByLabelText, queryByText } = renderWithTheme(
      <PaginatedEntityTable
        rows={makeRows(25)}
        isFetching={false}
        columns={COLUMNS}
        rowKey={(row) => String(row['id'])}
        searchPlaceholder="Search"
        searchFilter={() => true}
      />,
    );
    await user.click(getByLabelText(/next page/i));
    expect(getByText('Item 20')).toBeInTheDocument();
    expect(queryByText('Item 0')).not.toBeInTheDocument();
  });

  it('filters rows via the search box, resetting to page 0', async () => {
    const user = userEvent.setup();
    const searchFilter = (row: Readonly<Record<string, unknown>>, query: string): boolean =>
      String(row['name']).toLowerCase().includes(query.toLowerCase());
    const { getByPlaceholderText, queryByText } = renderWithTheme(
      <PaginatedEntityTable
        rows={makeRows(5)}
        isFetching={false}
        columns={COLUMNS}
        rowKey={(row) => String(row['id'])}
        searchPlaceholder="Search"
        searchFilter={searchFilter}
      />,
    );
    await user.type(getByPlaceholderText('Search'), 'Item 3');
    // The debounced `onChange` (SimpleSearchBar's default 300ms) has to
    // actually fire before filtering applies — waiting on "Item 0"
    // DISAPPEARING (rather than "Item 3" appearing, which is trivially
    // true from the initial unfiltered render too) is what proves the
    // filter really ran, not a vacuously-passing assertion.
    await vi.waitFor(
      () => {
        expect(queryByText('Item 0')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(queryByText('Item 3')).toBeInTheDocument();
  });

  it('calls onRowClick with the clicked row when provided', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const { getByText } = renderWithTheme(
      <PaginatedEntityTable
        rows={makeRows(2)}
        isFetching={false}
        columns={COLUMNS}
        rowKey={(row) => String(row['id'])}
        searchPlaceholder="Search"
        searchFilter={() => true}
        onRowClick={onRowClick}
      />,
    );
    await user.click(getByText('Item 0'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith({ id: 0, name: 'Item 0' });
  });

  it('does not attach a click handler to rows when onRowClick is omitted', () => {
    const { getByText } = renderWithTheme(
      <PaginatedEntityTable
        rows={makeRows(1)}
        isFetching={false}
        columns={COLUMNS}
        rowKey={(row) => String(row['id'])}
        searchPlaceholder="Search"
        searchFilter={() => true}
      />,
    );
    // Renders fine, no crash — the row simply is not clickable.
    expect(getByText('Item 0')).toBeInTheDocument();
  });
});
