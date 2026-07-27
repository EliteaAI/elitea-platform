import { useState } from 'react';

import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BaseTab } from '../BaseTab';
import { renderWithTheme } from '../lib/testTheme';
import { BaseTabs } from '.';

function ControlledTabs() {
  const [value, setValue] = useState(0);
  return (
    <BaseTabs
      value={value}
      onChange={(_event, next: number) => setValue(next)}
      aria-label="Sections"
    >
      <BaseTab label="Overview" />
      <BaseTab label="Settings" />
      <BaseTab label="History" />
    </BaseTabs>
  );
}

describe('BaseTabs', () => {
  it('renders one tab per child, exposing the tablist role', () => {
    const { getByRole, getAllByRole } = renderWithTheme(<ControlledTabs />);
    expect(getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    expect(getAllByRole('tab')).toHaveLength(3);
  });

  it('marks the active tab with aria-selected', () => {
    const { getByRole } = renderWithTheme(<ControlledTabs />);
    expect(getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'false');
  });

  it('switches the selected tab on click', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<ControlledTabs />);
    await user.click(getByRole('tab', { name: 'Settings' }));
    expect(getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false');
  });

  it('moves focus with ArrowRight/ArrowLeft (roving tabindex)', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<ControlledTabs />);
    getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(getByRole('tab', { name: 'Settings' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(getByRole('tab', { name: 'Overview' })).toHaveFocus();
  });

  it('selects the focused tab on Enter', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<ControlledTabs />);
    getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onChange with the new tab index', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <BaseTabs
        value={0}
        onChange={onChange}
        aria-label="Sections"
      >
        <BaseTab label="Overview" />
        <BaseTab label="Settings" />
      </BaseTabs>,
    );
    await user.click(getByRole('tab', { name: 'Settings' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[1]).toBe(1);
  });

  it('skips a disabled tab when clicked', () => {
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <BaseTabs
        value={0}
        onChange={onChange}
        aria-label="Sections"
      >
        <BaseTab label="Overview" />
        <BaseTab
          label="Locked"
          disabled
        />
      </BaseTabs>,
    );
    const lockedTab = getByRole('tab', { name: 'Locked' });
    expect(lockedTab).toBeDisabled();
    // A real mouse can never click a `pointer-events: none` disabled tab;
    // `fireEvent` dispatches the DOM event directly, proving the handler
    // itself is gated by the native `disabled` attribute too.
    fireEvent.click(lockedTab);
    expect(onChange).not.toHaveBeenCalled();
  });
});
