import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { RadioButtonGroup } from '.';

const ITEMS = [
  { value: 'a', label: 'Option A', description: 'The first option.' },
  { value: 'b', label: 'Option B', info: 'Why you might pick B.' },
  { value: 'c', label: 'Option C', disabled: true },
];

// Item A's description sits inside the same <label> as its label text (same
// structure as the baseline), so its computed accessible name is "Option A
// The first option." — matched with a prefix regex rather than an exact
// string. B and C have no description, so their names match exactly.

describe('RadioButtonGroup', () => {
  it('renders one radio per item, named after its label', () => {
    const { getByRole } = renderWithTheme(
      <RadioButtonGroup
        items={ITEMS}
        onChange={() => {}}
      />,
    );
    expect(getByRole('radio', { name: /^Option A/ })).toBeInTheDocument();
    expect(getByRole('radio', { name: 'Option B' })).toBeInTheDocument();
    expect(getByRole('radio', { name: 'Option C' })).toBeInTheDocument();
  });

  it('renders each item description', () => {
    const { getByText } = renderWithTheme(
      <RadioButtonGroup
        items={ITEMS}
        onChange={() => {}}
      />,
    );
    expect(getByText('The first option.')).toBeInTheDocument();
  });

  it('reflects the selected value', () => {
    const { getByRole } = renderWithTheme(
      <RadioButtonGroup
        items={ITEMS}
        value="b"
        onChange={() => {}}
      />,
    );
    expect(getByRole('radio', { name: 'Option B' })).toBeChecked();
    expect(getByRole('radio', { name: /^Option A/ })).not.toBeChecked();
  });

  it('calls onChange with the clicked item value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <RadioButtonGroup
        items={ITEMS}
        onChange={onChange}
      />,
    );
    await user.click(getByRole('radio', { name: /^Option A/ }));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('disables an individual item', () => {
    const { getByRole } = renderWithTheme(
      <RadioButtonGroup
        items={ITEMS}
        onChange={() => {}}
      />,
    );
    expect(getByRole('radio', { name: 'Option C' })).toBeDisabled();
    expect(getByRole('radio', { name: /^Option A/ })).not.toBeDisabled();
  });

  it('disables every item when disabled is set', () => {
    const { getByRole } = renderWithTheme(
      <RadioButtonGroup
        items={ITEMS}
        onChange={() => {}}
        disabled
      />,
    );
    expect(getByRole('radio', { name: /^Option A/ })).toBeDisabled();
    expect(getByRole('radio', { name: 'Option B' })).toBeDisabled();
  });

  it('wraps rows when wrapRow is set', () => {
    const { getByRole } = renderWithTheme(
      <RadioButtonGroup
        items={ITEMS}
        onChange={() => {}}
        wrapRow
      />,
    );
    expect(getByRole('radiogroup')).toBeInTheDocument();
  });

  it('gives the group an accessible name, falling back to a default', () => {
    const { getByRole } = renderWithTheme(
      <RadioButtonGroup
        items={ITEMS}
        onChange={() => {}}
      />,
    );
    expect(getByRole('radiogroup', { name: 'Options' })).toBeInTheDocument();
  });

  it('uses a custom aria-label for the group (the aria-labelledby fix)', () => {
    const { getByRole } = renderWithTheme(
      <RadioButtonGroup
        items={ITEMS}
        onChange={() => {}}
        aria-label="Choose an option"
      />,
    );
    expect(getByRole('radiogroup', { name: 'Choose an option' })).toBeInTheDocument();
  });
});
