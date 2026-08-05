import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { PipelineMultiSelect, type PipelineMultiSelectOption } from './PipelineMultiSelect';

const OPTIONS: PipelineMultiSelectOption[] = [
  { value: 'input', label: 'input' },
  { value: 'messages', label: 'messages' },
];

describe('PipelineMultiSelect', () => {
  it('renders a placeholder when nothing is selected', () => {
    const { getByText } = renderWithTheme(
      <PipelineMultiSelect
        value={[]}
        onValueChange={vi.fn()}
        options={OPTIONS}
      />,
    );
    expect(getByText('None')).toBeInTheDocument();
  });

  it('renders a chip per selected value', () => {
    const { getByText } = renderWithTheme(
      <PipelineMultiSelect
        value={['input', 'messages']}
        onValueChange={vi.fn()}
        options={OPTIONS}
      />,
    );
    expect(getByText('input')).toBeInTheDocument();
    expect(getByText('messages')).toBeInTheDocument();
  });

  it('shows a "No options" row when the options list is empty', async () => {
    const user = userEvent.setup();
    const { getByRole, getByText } = renderWithTheme(
      <PipelineMultiSelect
        value={[]}
        onValueChange={vi.fn()}
        options={[]}
      />,
    );
    await user.click(getByRole('combobox'));
    expect(getByText('No options')).toBeInTheDocument();
  });

  it('calls onValueChange with the newly selected value added', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <PipelineMultiSelect
        value={['input']}
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    );
    await user.click(getByRole('combobox'));
    await user.click(getByRole('option', { name: 'messages' }));
    expect(onValueChange).toHaveBeenCalledWith(['input', 'messages']);
  });

  it('calls onDeleteOption (not onValueChange) when a chip is removed and onDeleteOption is provided', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const onDeleteOption = vi.fn();
    const { getByTestId } = renderWithTheme(
      <PipelineMultiSelect
        value={['input']}
        onValueChange={onValueChange}
        options={OPTIONS}
        onDeleteOption={onDeleteOption}
      />,
    );
    await user.click(getByTestId('CancelIcon'));
    expect(onDeleteOption).toHaveBeenCalledWith('input');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('falls back to filtering the value out via onValueChange when onDeleteOption is omitted', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithTheme(
      <PipelineMultiSelect
        value={['input', 'messages']}
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    );
    const deleteIcons = document.querySelectorAll('[data-testid="CancelIcon"]');
    await user.click(deleteIcons[0] as Element);
    expect(onValueChange).toHaveBeenCalledWith(['messages']);
  });

  it('renders a synthesised option not present in the known options list', () => {
    const { getByText } = renderWithTheme(
      <PipelineMultiSelect
        value={['stale']}
        onValueChange={vi.fn()}
        options={[{ value: 'stale', label: 'stale', canDelete: true, tooltip: 'Not in state' }]}
      />,
    );
    expect(getByText('stale')).toBeInTheDocument();
  });

  it('renders a delete affordance instead of the checkmark for a canDelete row, and calls onDeleteOption when clicked', async () => {
    // Regression test for the dropped in-dropdown "delete instead of
    // checkmark" affordance: a `canDelete` option row must render a
    // delete control (not the plain selected-checkmark) whenever
    // `onDeleteOption` is supplied, and clicking it must call
    // `onDeleteOption` with that option's value -- without toggling the
    // option's own selection via the underlying MUI `Select`.
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const onDeleteOption = vi.fn();
    const { getByRole, queryByRole } = renderWithTheme(
      <PipelineMultiSelect
        value={['stale']}
        onValueChange={onValueChange}
        options={[{ value: 'stale', label: 'stale', canDelete: true }, ...OPTIONS]}
        onDeleteOption={onDeleteOption}
      />,
    );

    await user.click(getByRole('combobox'));
    const staleRow = getByRole('option', { name: /stale/ });
    expect(within(staleRow).getByRole('button', { name: /remove/i })).toBeInTheDocument();
    // The checkmark never renders on a canDelete row, even though it's selected.
    expect(within(staleRow).queryByTestId('CheckIcon')).not.toBeInTheDocument();

    await user.click(within(staleRow).getByRole('button', { name: /remove/i }));
    expect(onDeleteOption).toHaveBeenCalledWith('stale');
    expect(onValueChange).not.toHaveBeenCalled();
    // A genuinely selected, non-canDelete row still gets the checkmark.
    expect(queryByRole('option', { name: 'input' })).not.toBeNull();
  });

  it('falls back to the plain checkmark for a canDelete option when no onDeleteOption is supplied', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(
      <PipelineMultiSelect
        value={['stale']}
        onValueChange={vi.fn()}
        options={[{ value: 'stale', label: 'stale', canDelete: true }, ...OPTIONS]}
      />,
    );

    await user.click(getByRole('combobox'));
    const staleRow = getByRole('option', { name: 'stale' });
    expect(within(staleRow).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('applies the disabled state', () => {
    const { getByRole } = renderWithTheme(
      <PipelineMultiSelect
        value={[]}
        onValueChange={vi.fn()}
        options={OPTIONS}
        disabled
      />,
    );
    expect(getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
  });
});
