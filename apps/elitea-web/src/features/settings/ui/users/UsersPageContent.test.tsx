/**
 * Regression coverage for Settings → Users rendering nothing at all.
 *
 * The table + pagination block was wrapped in a bare
 * `{permissions.canView && ( … )}` with no `else`, and the page never read
 * `isError` from `useUserList` / `useRoleList` (`pages/settings/Users.tsx`
 * narrowed both query results to `{isFetching, refetch}`, so the field was
 * unreachable). Two different states therefore looked identical:
 *
 *  - a member without `users.view` (a live 403 on
 *    `GET /api/v2/admin/users/default/1`) saw the header and blank space;
 *  - a failed fetch fell through to `UsersTable`'s `users.length === 0`
 *    branch and stated "No users", which is not known to be true.
 *
 * The third state matters just as much: `usePermissionSet` answers an EMPTY
 * set while the permission request is in flight, so a banner gated on
 * `canView` alone flashes for every user on every load.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { UsersPageContent, type UsersPageContentProps } from './UsersPageContent';

function makeProps(overrides: Partial<UsersPageContentProps> = {}): UsersPageContentProps {
  return {
    data: { users: [], total: 0, filteredUsers: [], selectedUsers: [] },
    pagination: { rowsPerPage: 20, page: 0, pageSize: 20 },
    tableActions: {
      onSearchChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      onChangePage: vi.fn(),
      onSort: vi.fn(),
      onSelectPage: vi.fn(),
      onSelectRow: vi.fn(),
    },
    sorting: { sortField: 'name', sortDirection: 'asc' },
    search: { searchText: '' },
    toast: { toastMessage: '', toastType: 'success' },
    dialogs: {
      inviteOpen: false,
      actions: { edit: null, delete: {} },
      singleAction: {},
      batchAction: {},
      rolesOptions: [],
      onInviteConfirm: vi.fn(),
      onSetInviteOpen: vi.fn(),
    },
    permissions: { canView: true, canCreate: true, canEdit: true, canDelete: true },
    status: { isError: false, permissionsResolved: true, onRetry: vi.fn() },
    isLoading: false,
    ...overrides,
  };
}

describe('UsersPageContent', () => {
  it('says why the list is missing when the user lacks users.view', () => {
    renderWithTheme(
      <UsersPageContent
        {...makeProps({
          permissions: { canView: false, canCreate: false, canEdit: false, canDelete: false },
        })}
      />,
    );

    expect(
      screen.getByText('You do not have permission to view the project members.'),
    ).toBeInTheDocument();
  });

  it('replaces the table with an error and a retry when the fetch failed', async () => {
    const onRetry = vi.fn();
    renderWithTheme(
      <UsersPageContent {...makeProps({ status: { isError: true, permissionsResolved: true, onRetry } })} />,
    );

    expect(screen.getByText('The system did not load the project members.')).toBeInTheDocument();
    // "No users" is a claim about the project, and a failed request supports
    // no such claim. The error must REPLACE the table, not sit beside it.
    expect(screen.queryByText('No users')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows no permission banner while the permission request is still in flight', () => {
    renderWithTheme(
      <UsersPageContent
        {...makeProps({
          permissions: { canView: false, canCreate: false, canEdit: false, canDelete: false },
          status: { isError: false, permissionsResolved: false, onRetry: vi.fn() },
        })}
      />,
    );

    expect(
      screen.queryByText('You do not have permission to view the project members.'),
    ).not.toBeInTheDocument();
  });

  it('renders the member list once the request succeeds', () => {
    renderWithTheme(<UsersPageContent {...makeProps()} />);

    expect(screen.getByText('No users')).toBeInTheDocument();
    expect(
      screen.queryByText('You do not have permission to view the project members.'),
    ).not.toBeInTheDocument();
  });
});
