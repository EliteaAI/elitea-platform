import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { ViewRunHistoryButton } from '.';

describe('ViewRunHistoryButton', () => {
  it('renders an icon-only button named "View run history"', () => {
    const { getByRole } = renderWithTheme(<ViewRunHistoryButton />);
    expect(getByRole('button', { name: 'View run history' })).toBeInTheDocument();
  });

  it('carries the baseline test id by default', () => {
    const { getByTestId } = renderWithTheme(<ViewRunHistoryButton />);
    expect(getByTestId('pipeline-history-tab')).toBeInTheDocument();
  });

  it('accepts a custom data-testid', () => {
    const { getByTestId } = renderWithTheme(<ViewRunHistoryButton data-testid="custom-id" />);
    expect(getByTestId('custom-id')).toBeInTheDocument();
  });

  it('calls onShowHistory when clicked', async () => {
    const user = userEvent.setup();
    const onShowHistory = vi.fn();
    const { getByRole } = renderWithTheme(<ViewRunHistoryButton onShowHistory={onShowHistory} />);
    await user.click(getByRole('button'));
    expect(onShowHistory).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onShowHistory is not provided', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<ViewRunHistoryButton />);
    await user.click(getByRole('button'));
  });

  it('exposes dataTour as a plain data attribute (the features-import workaround)', () => {
    const { getByRole } = renderWithTheme(<ViewRunHistoryButton dataTour="run-history-target" />);
    expect(getByRole('button')).toHaveAttribute('data-tour', 'run-history-target');
  });
});
