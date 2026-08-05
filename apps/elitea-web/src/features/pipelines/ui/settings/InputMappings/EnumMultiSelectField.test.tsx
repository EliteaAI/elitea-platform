import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { EnumMultiSelectField } from './EnumMultiSelectField';

const OPTIONS = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta', value: 'beta' },
  { label: 'Gamma', value: 'gamma' },
];

describe('EnumMultiSelectField', () => {
  it('renders a chip for every selected value', () => {
    const { getByText } = renderWithTheme(
      <EnumMultiSelectField
        label="Options"
        value={['alpha', 'beta']}
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    expect(getByText('Alpha')).toBeInTheDocument();
    expect(getByText('Beta')).toBeInTheDocument();
  });

  it('renders no chips when nothing is selected', () => {
    const { queryByText } = renderWithTheme(
      <EnumMultiSelectField
        label="Options"
        value={[]}
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    expect(queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('adds an option to the selection when picked from the dropdown', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole, findByRole } = renderWithTheme(
      <EnumMultiSelectField
        label="Options"
        value={['alpha']}
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    await user.click(getByRole('combobox'));
    await user.click(await findByRole('option', { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledWith(['alpha', 'beta']);
  });

  it('removes a value when its chip delete button is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getAllByTestId } = renderWithTheme(
      <EnumMultiSelectField
        label="Options"
        value={['alpha', 'beta']}
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    const [firstDeleteIcon] = getAllByTestId('enum-multi-select-chip-delete');
    if (!firstDeleteIcon) throw new Error('delete icon not found');
    await user.click(firstDeleteIcon);
    expect(onChange).toHaveBeenCalledWith(['beta']);
  });

  it('omits the delete affordance on chips when disabled', () => {
    const { queryAllByTestId } = renderWithTheme(
      <EnumMultiSelectField
        label="Options"
        value={['alpha']}
        options={OPTIONS}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(queryAllByTestId('enum-multi-select-chip-delete')).toHaveLength(0);
  });
});
