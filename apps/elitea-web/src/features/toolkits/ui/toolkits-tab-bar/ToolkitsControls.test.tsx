import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ControlsDropdownItem } from '@/shared/ui/ControlsDropdown';

import { renderWithProviders } from '../../__tests__/testUtils';
import { ToolkitsControls } from './ToolkitsControls';

const menuItems: ControlsDropdownItem[] = [{ key: 'delete', label: 'Delete', onClick: vi.fn() }];

describe('ToolkitsControls', () => {
  it('renders the dropdown trigger', () => {
    renderWithProviders(
      <ToolkitsControls
        viewMode="owner"
        menuItems={menuItems}
      />,
    );
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });

  it('does not render the authors slot for the owner view', () => {
    renderWithProviders(
      <ToolkitsControls
        viewMode="owner"
        menuItems={menuItems}
        authorsSlot={<div data-testid="authors" />}
      />,
    );
    expect(screen.queryByTestId('authors')).not.toBeInTheDocument();
  });

  it('renders the authors slot for the public view', () => {
    renderWithProviders(
      <ToolkitsControls
        viewMode="public"
        menuItems={menuItems}
        authorsSlot={<div data-testid="authors" />}
      />,
    );
    expect(screen.getByTestId('authors')).toBeInTheDocument();
  });

  it('renders the caller-supplied menu items in the dropdown', () => {
    renderWithProviders(
      <ToolkitsControls
        viewMode="owner"
        menuItems={menuItems}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('fires the supplied item onClick', () => {
    const onClick = vi.fn();
    renderWithProviders(
      <ToolkitsControls
        viewMode="owner"
        menuItems={[{ key: 'delete', label: 'Delete', onClick }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByText('Delete'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
