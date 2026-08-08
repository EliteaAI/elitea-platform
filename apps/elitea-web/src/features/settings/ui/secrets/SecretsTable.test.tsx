/**
 * Regression coverage for #137 defect 2: an EMPTY secrets list used to render
 * eight skeletons forever.
 *
 *     if (isFetching || rows.length === 0)   // → 8 <Skeleton>
 *
 * A project with no secrets is the normal first-run state and is exactly what
 * a correctly-routed backend returns, so the product's default secrets screen
 * was an indefinite loading spinner with no grid, no column headers and no
 * pagination footer.
 *
 * These tests hold the three states apart: loading (skeletons), settled-empty
 * (grid + "No secrets" + footer, zero skeletons) and settled-with-rows.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import type { SecretRow } from '@/entities/secret';

import { SECRETS_SKELETON_TESTID, SecretsTable, type SecretsTableProps } from './SecretsTable';

function makeProps(overrides: Partial<SecretsTableProps> = {}): SecretsTableProps {
  return {
    rows: [],
    setRows: vi.fn(),
    rowModesModel: {},
    setRowModesModel: vi.fn(),
    isFetching: false,
    isShowSecretMap: {},
    canUnsecret: true,
    validationErrors: {},
    onValidationChange: vi.fn(),
    actions: {
      onSave: () => async () => {},
      onCancel: () => () => {},
      onShowSecret: () => async () => {},
      onHideSecret: () => {},
      onCopySecretValue: () => async () => {},
      onActionsMenuClick: () => () => {},
      onEdit: () => async () => {},
      onHide: () => () => {},
      onDelete: () => () => {},
      onCloseAlert: () => () => {},
      onConfirmAlert: () => () => {},
    },
    menu: { anchorEl: null, anchorRowId: null, onCloseMenu: vi.fn() },
    dialog: { openAlert: null, openAlertType: '' },
    ...overrides,
  };
}

const existingRow: SecretRow = {
  id: 'existing-API_KEY',
  name: 'API_KEY',
  secretName: '{{secret.API_KEY}}',
  isDefault: false,
  secretValue: '{{secret.API_KEY}}',
  isNew: false,
};

describe('SecretsTable', () => {
  it('renders the grid, an empty state and the footer when the list settled with no secrets', () => {
    renderWithTheme(<SecretsTable {...makeProps({ rows: [], isFetching: false })} />);

    // The defect: eight skeletons instead of a table.
    expect(screen.queryAllByTestId(SECRETS_SKELETON_TESTID)).toHaveLength(0);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getByText('No secrets')).toBeInTheDocument();
    // The footer only renders past the skeleton guard.
    expect(screen.getByText('Rows per page')).toBeInTheDocument();
  });

  it('renders skeletons only while the list is genuinely fetching', () => {
    renderWithTheme(<SecretsTable {...makeProps({ rows: [], isFetching: true })} />);

    expect(screen.getAllByTestId(SECRETS_SKELETON_TESTID).length).toBeGreaterThan(0);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByText('No secrets')).not.toBeInTheDocument();
  });

  it('renders the rows, and no empty state, once there are secrets', () => {
    renderWithTheme(<SecretsTable {...makeProps({ rows: [existingRow] })} />);

    const grid = screen.getByRole('grid');
    expect(within(grid).getAllByText('API_KEY').length).toBeGreaterThan(0);
    expect(screen.queryByText('No secrets')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(SECRETS_SKELETON_TESTID)).toHaveLength(0);
  });
});
