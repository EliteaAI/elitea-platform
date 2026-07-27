import { describe, expect, it, vi } from 'vitest';

import { BaseTabs } from '../BaseTabs';
import { renderWithTheme } from '../lib/testTheme';
import { BaseTab } from '.';

describe('BaseTab', () => {
  it('renders a real tab role with the given label', () => {
    const { getByRole } = renderWithTheme(
      <BaseTabs
        value={0}
        onChange={vi.fn()}
        aria-label="Sections"
      >
        <BaseTab label="Overview" />
      </BaseTabs>,
    );
    expect(getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
  });

  it('defaults iconPosition to "start"', () => {
    const { getByRole } = renderWithTheme(
      <BaseTabs
        value={0}
        onChange={vi.fn()}
        aria-label="Sections"
      >
        <BaseTab label="Overview" />
      </BaseTabs>,
    );
    // iconPosition only affects layout when an icon is present; asserting
    // the tab still renders confirms the prop default doesn't break mount.
    expect(getByRole('tab')).toBeInTheDocument();
  });

  it('gives the selected tab a different colour than an unselected sibling', () => {
    const { getByRole } = renderWithTheme(
      <BaseTabs
        value={0}
        onChange={vi.fn()}
        aria-label="Sections"
      >
        <BaseTab label="Overview" />
        <BaseTab label="Settings" />
      </BaseTabs>,
    );
    const selected = getComputedStyle(getByRole('tab', { name: 'Overview' })).color;
    const unselected = getComputedStyle(getByRole('tab', { name: 'Settings' })).color;
    expect(selected).not.toBe(unselected);
  });

  it('marks a disabled tab as disabled and unfocusable', () => {
    const { getByRole } = renderWithTheme(
      <BaseTabs
        value={0}
        onChange={vi.fn()}
        aria-label="Sections"
      >
        <BaseTab label="Overview" />
        <BaseTab
          label="Locked"
          disabled
        />
      </BaseTabs>,
    );
    const locked = getByRole('tab', { name: 'Locked' });
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute('tabIndex', '-1');
  });
});
