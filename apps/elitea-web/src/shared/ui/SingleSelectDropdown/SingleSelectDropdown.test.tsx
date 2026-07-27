import Menu from '@mui/material/Menu';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import type { SingleSelectOption } from '../SingleSelectMenuItem';
import { SingleSelectDropdown } from '.';

const option: SingleSelectOption = { value: 'claude', label: 'Claude' };

describe('SingleSelectDropdown', () => {
  it('stamps the stable select-option-<value> test hook and renders the label', () => {
    const { getByTestId } = renderWithTheme(
      <Menu
        open
        anchorReference="none"
      >
        <SingleSelectDropdown
          option={option}
          value={option.value}
          isSelected={false}
        />
      </Menu>,
    );
    const row = getByTestId('select-option-claude');
    expect(row).toHaveTextContent('Claude');
  });

  it('forwards isSelected through to the rendered checkmark', () => {
    const { getByTestId } = renderWithTheme(
      <Menu
        open
        anchorReference="none"
      >
        <SingleSelectDropdown
          option={option}
          value={option.value}
          isSelected
        />
      </Menu>,
    );
    // The checked icon only renders when selected — presence of an extra
    // ListItemIcon beyond the label confirms the prop reached MenuItem.
    expect(getByTestId('select-option-claude').querySelectorAll('svg').length).toBeGreaterThan(0);
  });
});
