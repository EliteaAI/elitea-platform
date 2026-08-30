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

  it('explains where the rows come from, so a row that appears or vanishes with the instructions is not a mystery', () => {
    renderWithProviders(
      <ApplicationVariables
        variables={[{ name: 'topic', value: '' }]}
        onChangeVariable={vi.fn()}
      />,
    );
    expect(screen.getByTestId('application-variables')).toBeInTheDocument();
    expect(screen.getByText(/One row per placeholder in the instructions/)).toBeInTheDocument();
  });

  it('renders no literal double-brace interpolation artefact in the hint (i18next would swallow one)', () => {
    renderWithProviders(
      <ApplicationVariables
        variables={[{ name: 'topic', value: '' }]}
        onChangeVariable={vi.fn()}
      />,
    );
    const hint = screen.getByText(/One row per placeholder in the instructions/);
    expect(hint.textContent).not.toContain('{{');
    expect(hint.textContent).not.toMatch(/\bundefined\b/);
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
