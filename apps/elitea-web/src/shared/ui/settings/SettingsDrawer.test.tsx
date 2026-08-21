import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { SettingsDrawer, type SettingsSection } from './SettingsDrawer';

const SECTIONS: SettingsSection[] = [
  {
    section: 'PROJECT',
    tabs: [
      { id: 'model-configuration', label: 'AI Configuration' },
      { id: 'secrets', label: 'Secrets' },
    ],
  },
  {
    section: 'PERSONAL',
    tabs: [
      { id: 'tokens', label: 'Personal Tokens' },
      { id: 'logout', label: 'Log out' },
    ],
  },
];

/**
 * `SettingsDrawer` reads `useLocation`, so it needs a router. The drawer is
 * mounted at /settings/secrets, which makes "Secrets" the active tab.
 */
function renderDrawer(onItemClick = vi.fn()) {
  const rootRoute = createRootRoute();
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/$tab',
    component: () => (
      <SettingsDrawer
        sections={SECTIONS}
        onItemClick={onItemClick}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([settingsRoute]),
    history: createMemoryHistory({ initialEntries: ['/settings/secrets'] }),
  });
  renderWithTheme(<RouterProvider router={router as never} />);
  return { onItemClick };
}

describe('SettingsDrawer', () => {
  /**
   * A REAL BUTTON, NOT A DIV WITH onClick. Every item was a plain
   * `<Box onClick>` — a <div> with no role, no tabindex and no href — so a
   * keyboard reached none of them and assistive technology read all eleven
   * labels, "Log out" included, as plain text. That is what the accessibility
   * tree of a live deployment reported.
   */
  it('renders every menu item as a real button', async () => {
    renderDrawer();
    for (const label of ['AI Configuration', 'Secrets', 'Personal Tokens', 'Log out']) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the active item with aria-current, and no other item', async () => {
    renderDrawer();
    const active = await screen.findByRole('button', { name: 'Secrets' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'AI Configuration' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Log out' })).not.toHaveAttribute('aria-current');
  });

  it('activates an item from the keyboard alone', async () => {
    const user = userEvent.setup();
    const { onItemClick } = renderDrawer();
    const tokens = await screen.findByRole('button', { name: 'Personal Tokens' });

    tokens.focus();
    expect(tokens).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(onItemClick).toHaveBeenCalledWith('tokens');
    });
  });
});
