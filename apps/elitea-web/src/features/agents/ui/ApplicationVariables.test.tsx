import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../__tests__/testUtils';

import { ApplicationVariables } from './ApplicationVariables';

describe('ApplicationVariables', () => {
  it('renders nothing when there are no variables', () => {
    const { container } = renderWithProviders(
      <ApplicationVariables
        variables={[]}
        onChangeVariable={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when variables is undefined', () => {
    const { container } = renderWithProviders(
      <ApplicationVariables
        variables={undefined}
        onChangeVariable={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per variable, labelled by name', () => {
    renderWithProviders(
      <ApplicationVariables
        variables={[
          { name: 'first_name', value: 'Ada' },
          { name: 'last_name', value: 'Lovelace' },
        ]}
        onChangeVariable={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Ada')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Lovelace')).toBeInTheDocument();
  });

  it('renders each variable row collapsed by default, not pre-expanded', () => {
    // Baseline (`components/VariableList.jsx`) starts every variable field
    // collapsed via `collapseContent`. `expand={{minRows,maxRows}}` without
    // `collapsed: true` makes `InputBase` initialise `rows` to `maxRows`
    // (fully expanded) — the toolbar would render "Collapse field" instead
    // of "Expand field" on first render if that regressed.
    renderWithProviders(
      <ApplicationVariables
        variables={[{ name: 'first_name', value: 'Ada' }]}
        onChangeVariable={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Expand field' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse field' })).not.toBeInTheDocument();
  });

  it('calls onChangeVariable with the variable name and new value', () => {
    const onChangeVariable = vi.fn();
    renderWithProviders(
      <ApplicationVariables
        variables={[{ name: 'first_name', value: 'Ada' }]}
        onChangeVariable={onChangeVariable}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('Ada'), { target: { value: 'Grace' } });
    expect(onChangeVariable).toHaveBeenCalledWith('first_name', 'Grace');
  });
});
