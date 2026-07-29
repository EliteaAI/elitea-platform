import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Conversation } from '@/entities/conversation';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { PinnedConversations } from './PinnedConversations';

function mkConv(id: string): Conversation {
  return { id, name: id, isPrivate: true };
}

describe('PinnedConversations', () => {
  it('renders nothing when there are no pinned conversations', () => {
    const renderConversationItem = vi.fn();
    const { container } = renderWithTheme(
      <PinnedConversations
        pinnedConversations={[]}
        renderConversationItem={renderConversationItem}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(renderConversationItem).not.toHaveBeenCalled();
  });

  it('calls renderConversationItem once per pinned conversation, in order, with isNextItemHovered starting false', () => {
    const conversations = [mkConv('a'), mkConv('b'), mkConv('c')];
    const renderConversationItem = vi.fn((conversation: Conversation, _onItemHover: (itemId: string, isHovered: boolean) => void, _isNextItemHovered: boolean) => (
      <div key={conversation.id}>{conversation.id}</div>
    ));

    renderWithTheme(
      <PinnedConversations
        pinnedConversations={conversations}
        renderConversationItem={renderConversationItem}
      />,
    );

    expect(renderConversationItem).toHaveBeenCalledTimes(3);
    expect(renderConversationItem.mock.calls[0]?.[0]).toEqual(conversations[0]);
    expect(renderConversationItem.mock.calls[0]?.[2]).toBe(false);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
  });

  it('marks the PREVIOUS row as isNextItemHovered once a row reports hover through onItemHover', async () => {
    const conversations = [mkConv('a'), mkConv('b')];

    function Row({ conversation, onItemHover, isNextItemHovered }: { conversation: Conversation; onItemHover: (id: string, hovered: boolean) => void; isNextItemHovered: boolean }) {
      return (
        <button
          type="button"
          data-next-hovered={isNextItemHovered}
          onMouseEnter={() => onItemHover(conversation.id, true)}
        >
          {conversation.id}
        </button>
      );
    }

    renderWithTheme(
      <PinnedConversations
        pinnedConversations={conversations}
        renderConversationItem={(conversation, onItemHover, isNextItemHovered) => (
          <Row
            key={conversation.id}
            conversation={conversation}
            onItemHover={onItemHover}
            isNextItemHovered={isNextItemHovered}
          />
        )}
      />,
    );

    expect(screen.getByText('a').getAttribute('data-next-hovered')).toBe('false');

    await userEvent.hover(screen.getByText('b'));

    expect(screen.getByText('a').getAttribute('data-next-hovered')).toBe('true');
    expect(screen.getByText('b').getAttribute('data-next-hovered')).toBe('false');
  });
});
