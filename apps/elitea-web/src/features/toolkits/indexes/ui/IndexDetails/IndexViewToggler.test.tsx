import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { IndexViewToggler } from './IndexViewToggler';

describe('IndexViewToggler', () => {
  it('renders the three tabs, active tab selected', () => {
    const { getByRole } = renderWithTheme(
      <IndexViewToggler
        activeTab="run"
        onChangeTab={vi.fn()}
      />,
    );
    expect(getByRole('button', { name: 'run' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('button', { name: 'configuration' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChangeTab with the newly selected value', async () => {
    const user = userEvent.setup();
    const onChangeTab = vi.fn();
    const { getByRole } = renderWithTheme(
      <IndexViewToggler
        activeTab="run"
        onChangeTab={onChangeTab}
      />,
    );
    await user.click(getByRole('button', { name: 'history' }));
    expect(onChangeTab).toHaveBeenCalled();
    expect(onChangeTab.mock.calls[0]?.[1]).toBe('history');
  });

  it('disables the run tab when a reason is supplied', () => {
    const { getByRole } = renderWithTheme(
      <IndexViewToggler
        activeTab="configuration"
        onChangeTab={vi.fn()}
        disableRunTabReason="No index selected"
      />,
    );
    expect(getByRole('button', { name: 'run' })).toBeDisabled();
  });

  it('disables the history tab when a reason is supplied', () => {
    const { getByRole } = renderWithTheme(
      <IndexViewToggler
        activeTab="configuration"
        onChangeTab={vi.fn()}
        disableHistoryTabReason="No history items"
      />,
    );
    expect(getByRole('button', { name: 'history' })).toBeDisabled();
  });
});
