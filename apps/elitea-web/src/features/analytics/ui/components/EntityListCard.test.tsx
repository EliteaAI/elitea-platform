import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { EntityListCard } from './EntityListCard';
import type { EntityListColumn } from './EntityListCard';

const COLUMNS: readonly EntityListColumn[] = [
  { header: 'User', flex: 3, render: (row) => String(row['name']) },
  { header: 'Calls', flex: 1, render: (row) => String(row['calls']) },
];

describe('EntityListCard', () => {
  it('renders the title, subtitle and column headers', () => {
    const { getByText } = renderWithTheme(
      <EntityListCard
        title="Users"
        subtitle="0 users"
        rows={[]}
        rowKey={(_row, index) => String(index)}
        columns={COLUMNS}
        emptyText="No user data"
      />,
    );
    expect(getByText('Users')).toBeInTheDocument();
    expect(getByText('0 users')).toBeInTheDocument();
    expect(getByText('User')).toBeInTheDocument();
    expect(getByText('Calls')).toBeInTheDocument();
  });

  it('renders the empty-state text when there are no rows', () => {
    const { getByText } = renderWithTheme(
      <EntityListCard
        title="Users"
        subtitle="0 users"
        rows={[]}
        rowKey={(_row, index) => String(index)}
        columns={COLUMNS}
        emptyText="No user data"
      />,
    );
    expect(getByText('No user data')).toBeInTheDocument();
  });

  it('renders one row per entry via each column\'s render function', () => {
    const { getByText, queryByText } = renderWithTheme(
      <EntityListCard
        title="Users"
        subtitle="2 users"
        rows={[
          { name: 'alice', calls: 3 },
          { name: 'bob', calls: 5 },
        ]}
        rowKey={(row) => String(row['name'])}
        columns={COLUMNS}
        emptyText="No user data"
      />,
    );
    expect(getByText('alice')).toBeInTheDocument();
    expect(getByText('bob')).toBeInTheDocument();
    expect(getByText('3')).toBeInTheDocument();
    expect(getByText('5')).toBeInTheDocument();
    expect(queryByText('No user data')).not.toBeInTheDocument();
  });
});
