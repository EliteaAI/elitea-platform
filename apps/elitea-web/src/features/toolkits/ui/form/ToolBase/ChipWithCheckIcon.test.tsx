import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ChipWithCheckIcon } from './ChipWithCheckIcon';

describe('ChipWithCheckIcon', () => {
  it('renders the label', () => {
    const { getByText } = renderWithTheme(
      <ChipWithCheckIcon
        isSelected={false}
        label="google"
      />,
    );
    expect(getByText('google')).toBeInTheDocument();
  });

  it('calls onClick when clickable and clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByText } = renderWithTheme(
      <ChipWithCheckIcon
        isSelected={false}
        label="google"
        onClick={onClick}
      />,
    );
    await user.click(getByText('google'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not wire onClick when not clickable', () => {
    const onClick = vi.fn();
    const { getByText } = renderWithTheme(
      <ChipWithCheckIcon
        isSelected={false}
        label="google"
        clickable={false}
        onClick={onClick}
      />,
    );
    // MUI renders a non-interactive chip (no button role) when clickable=false.
    expect(getByText('google').closest('[role="button"]')).not.toBeInTheDocument();
  });

  it('renders a custom icon when provided instead of the default checked icon', () => {
    const { getByTestId } = renderWithTheme(
      <ChipWithCheckIcon
        isSelected
        label="jira"
        icon={<span data-testid="custom-icon" />}
      />,
    );
    expect(getByTestId('custom-icon')).toBeInTheDocument();
  });
});
