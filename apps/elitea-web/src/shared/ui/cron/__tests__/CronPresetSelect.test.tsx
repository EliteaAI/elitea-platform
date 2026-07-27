import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../../lib/testTheme';
import { CronPresetSelect } from '../CronPresetSelect';

describe('CronPresetSelect', () => {
  it('shows "Custom" when no preset matches the current value', () => {
    renderWithTheme(<CronPresetSelect activePresetId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveTextContent('Custom');
  });

  it('shows the matching preset\'s label when one is active', () => {
    renderWithTheme(<CronPresetSelect activePresetId="hourly" onSelect={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveTextContent('Every hour');
  });

  it('calls onSelect with the chosen preset\'s expression', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithTheme(<CronPresetSelect activePresetId={null} onSelect={onSelect} />);

    await user.click(screen.getByRole('combobox', { name: 'Preset' }));
    await user.click(await screen.findByRole('option', { name: 'Every Saturday at midnight' }));

    expect(onSelect).toHaveBeenCalledWith('0 0 * * 6');
  });

  it('disables the dropdown when disabled', () => {
    renderWithTheme(<CronPresetSelect activePresetId={null} onSelect={vi.fn()} disabled />);
    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveAttribute('aria-disabled', 'true');
  });
});
