import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ConversationSearchButton } from './ConversationSearchButton';

describe('ConversationSearchButton', () => {
  it('activates search directly when not collapsed', async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    const onSearchActivate = vi.fn();

    renderWithTheme(
      <ConversationSearchButton
        collapsed={false}
        onExpand={onExpand}
        onSearchActivate={onSearchActivate}
      />,
    );

    await user.click(screen.getByTestId('conversation-search-button'));

    expect(onExpand).not.toHaveBeenCalled();
    expect(onSearchActivate).toHaveBeenCalledWith(true);
  });

  it('expands first, then activates search, when collapsed', async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    const onSearchActivate = vi.fn();

    renderWithTheme(
      <ConversationSearchButton
        collapsed
        onExpand={onExpand}
        onSearchActivate={onSearchActivate}
      />,
    );

    await user.click(screen.getByTestId('conversation-search-button'));

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onSearchActivate).toHaveBeenCalledWith(true);
  });

  it('has an accessible name from the tooltip copy', () => {
    renderWithTheme(<ConversationSearchButton />);
    expect(screen.getByRole('button', { name: 'Search chats' })).toBeInTheDocument();
  });
});
