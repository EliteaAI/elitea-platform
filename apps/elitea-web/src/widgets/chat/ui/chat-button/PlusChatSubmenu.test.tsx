/**
 * `PlusChatSubmenu` / `DropdownFooter`: MUI 9.2 `MenuItem` outside a menu list.
 *
 * Both components render `MenuItem` rows under a bare `Popper`/`Paper`, not
 * under a `Menu`. In MUI 9.2 `MenuItem` calls `useMenuListContext()`
 * unconditionally, and that hook THROWS
 * `"MUI: MenuListContext is missing. MenuItems must be placed within Menu or
 * MenuList."` when no provider is above it. So every "+"-menu submenu
 * (Modules/Agents/Pipelines/Toolkits/MCPs) and every open of the participants
 * dropdown blew up the surrounding error boundary instead of showing rows.
 *
 * These render the components exactly as their real callers do — standalone,
 * with NO `Menu`/`MenuList` supplied by the test — so a regression that drops
 * the provider fails here rather than only in the browser.
 */
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import DropdownFooter from '@/features/chat-participants/ui/UsersParticipantDropdown/DropdownFooter';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { PlusChatSubmenu } from './PlusChatSubmenu';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function Harness({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
      {children}
    </ThemeProvider>
  );
}

describe('PlusChatSubmenu renders outside a Menu', () => {
  it('renders its item rows without a Menu/MenuList ancestor', async () => {
    const onClick = vi.fn();
    render(
      <Harness>
        <PlusChatSubmenu items={[{ key: 'a', label: 'Agent One', onClick }]} />
      </Harness>,
    );

    const row = screen.getByText('Agent One');
    await userEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders the create-new row and the empty state without a Menu ancestor', () => {
    render(
      <Harness>
        <PlusChatSubmenu items={[]} showCreateNew onCreateNew={vi.fn()} createNewLabel="Create new" emptyMessage="Nothing available" />
      </Harness>,
    );

    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.getByText('Nothing available')).toBeInTheDocument();
  });
});

describe('UsersParticipantDropdown footer renders outside a Menu', () => {
  it('renders the "All users" row under a bare Paper', async () => {
    const onSelectAll = vi.fn();
    render(
      <Harness>
        <DropdownFooter usersCount={3} onSelectAll={onSelectAll} />
      </Harness>,
    );

    await userEvent.click(screen.getByText('All users'));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });
});
