import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import type { SingleSelectOption } from '.';
import { SingleSelect } from '.';

const options: SingleSelectOption[] = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini', disabled: true },
];

describe('SingleSelect', () => {
  it('renders the label and associates it with the combobox', () => {
    const { getByLabelText } = renderWithTheme(
      <SingleSelect
        value=""
        options={options}
        label="Model"
        onChange={() => {}}
      />,
    );
    expect(getByLabelText('Model')).toBeInTheDocument();
  });

  it('shows the placeholder text when the value matches no option', () => {
    const { getByText } = renderWithTheme(
      <SingleSelect
        value=""
        options={options}
        placeholder="Choose a model"
        onChange={() => {}}
      />,
    );
    expect(getByText('Choose a model')).toBeInTheDocument();
  });

  it('shows the matching option label when a value is selected', () => {
    const { getByText } = renderWithTheme(
      <SingleSelect
        value="claude"
        options={options}
        onChange={() => {}}
      />,
    );
    expect(getByText('Claude')).toBeInTheDocument();
  });

  it('opens the listbox and lists every option on click', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(
      <SingleSelect
        value=""
        options={options}
        onChange={() => {}}
      />,
    );
    await user.click(getByRole('combobox'));
    expect(getByRole('option', { name: 'GPT-4o' })).toBeInTheDocument();
    expect(getByRole('option', { name: 'Claude' })).toBeInTheDocument();
    expect(getByRole('option', { name: 'Gemini' })).toBeInTheDocument();
  });

  it('calls onChange with the clicked option value and closes the listbox', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole, queryByRole } = renderWithTheme(
      <SingleSelect
        value=""
        options={options}
        onChange={onChange}
      />,
    );
    await user.click(getByRole('combobox'));
    await user.click(getByRole('option', { name: 'Claude' }));
    expect(onChange).toHaveBeenCalledWith('claude');
    expect(queryByRole('option', { name: 'Claude' })).not.toBeInTheDocument();
  });

  it('marks a disabled option as aria-disabled and does not select it on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <SingleSelect
        value=""
        options={options}
        onChange={onChange}
      />,
    );
    await user.click(getByRole('combobox'));
    const disabledOption = getByRole('option', { name: 'Gemini' });
    expect(disabledOption).toHaveAttribute('aria-disabled', 'true');
  });

  it('supports full keyboard traversal: Enter opens, ArrowDown moves, Enter selects', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <SingleSelect
        value=""
        options={options}
        onChange={onChange}
      />,
    );
    const trigger = getByRole('combobox');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(getByRole('option', { name: 'GPT-4o' })).toBeInTheDocument();
    // No option matches the current (empty) value, so MUI's Select does not
    // pre-focus any row on open — the first ArrowDown lands on the first
    // option (unlike a plain `Menu`, which auto-focuses its first item;
    // verified empirically, not assumed).
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('gpt-4o');
  });

  it('calls onClear (not onChange) when the already-selected option is clicked again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();
    const { getByRole } = renderWithTheme(
      <SingleSelect
        value="claude"
        options={options}
        onChange={onChange}
        onClear={onClear}
      />,
    );
    await user.click(getByRole('combobox'));
    await user.click(getByRole('option', { name: 'Claude' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the error message and marks the control invalid', () => {
    const { getByText, getByRole } = renderWithTheme(
      <SingleSelect
        value=""
        options={options}
        error="A model is required"
        onChange={() => {}}
      />,
    );
    expect(getByText('A model is required')).toBeInTheDocument();
    expect(getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('marks the control disabled', () => {
    const { getByRole } = renderWithTheme(
      <SingleSelect
        value=""
        options={options}
        disabled
        onChange={() => {}}
      />,
    );
    expect(getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
  });

  it('falls back to an aria-label built from the placeholder when no visible label is given', () => {
    const { getByRole } = renderWithTheme(
      <SingleSelect
        value=""
        options={options}
        placeholder="Choose a model"
        onChange={() => {}}
      />,
    );
    expect(getByRole('combobox', { name: 'Choose a model' })).toBeInTheDocument();
  });

  it('renders a disabled placeholder row when there are no options', () => {
    const { getByRole } = renderWithTheme(
      <SingleSelect
        value=""
        options={[]}
        onChange={() => {}}
      />,
    );
    expect(getByRole('combobox')).toBeInTheDocument();
  });
});
