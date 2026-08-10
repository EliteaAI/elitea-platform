import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Conversation } from '@/entities/conversation';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { DropAreaState } from '../../lib/hooks/useDragAndDrop';
import { DateGroup } from './DateGroup';
import type { RenderConversationItem } from './DateGroup';

function mkConversation(overrides: Partial<Conversation> & { readonly id: string }): Conversation {
  return { name: overrides.id, isPrivate: true, ...overrides };
}

const renderItem: RenderConversationItem = (conversation, onItemHover, isNextItemHovered) => (
  <div
    key={conversation.id}
    data-testid={`conv-${conversation.id}`}
    onMouseEnter={() => onItemHover(conversation.id, true)}
    onMouseLeave={() => onItemHover(conversation.id, false)}
  >
    {conversation.name}
    {isNextItemHovered ? ' (next-hovered)' : ''}
  </div>
);

describe('DateGroup', () => {
  it('shows displayName when present, falling back to the raw group name otherwise', () => {
    const { rerender } = renderWithTheme(
      <DateGroup
        group={{ name: 'today', displayName: 'Today', conversations: [] }}
        renderConversationItem={renderItem}
        isExpanded
        onToggleExpanded={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByText('Today')).toBeInTheDocument();

    rerender(
      <DateGroup
        group={{ name: 'some_unmapped_group', conversations: [] }}
        renderConversationItem={renderItem}
        isExpanded
        onToggleExpanded={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByText('some_unmapped_group')).toBeInTheDocument();
  });

  it('calls onToggleExpanded(group.name) when the header is clicked', () => {
    const onToggleExpanded = vi.fn();
    renderWithTheme(
      <DateGroup
        group={{ name: 'today', displayName: 'Today', conversations: [] }}
        renderConversationItem={renderItem}
        isExpanded={false}
        onToggleExpanded={onToggleExpanded}
        onLoadMore={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onToggleExpanded).toHaveBeenCalledWith('today');
  });

  it('rotates the chevron based on isExpanded', () => {
    const { rerender, getByTestId } = renderWithTheme(
      <DateGroup
        group={{ name: 'today', displayName: 'Today', conversations: [] }}
        renderConversationItem={renderItem}
        isExpanded={false}
        onToggleExpanded={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(getByTestId('date-group-chevron')).toHaveStyle({ transform: 'rotate(0deg)' });

    rerender(
      <DateGroup
        group={{ name: 'today', displayName: 'Today', conversations: [] }}
        renderConversationItem={renderItem}
        isExpanded
        onToggleExpanded={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(getByTestId('date-group-chevron')).toHaveStyle({ transform: 'rotate(90deg)' });
  });

  it('renders one item per conversation via renderConversationItem, in order', () => {
    const conversations = [mkConversation({ id: 'c1' }), mkConversation({ id: 'c2' }), mkConversation({ id: 'c3' })];
    renderWithTheme(
      <DateGroup
        group={{ name: 'today', displayName: 'Today', conversations }}
        renderConversationItem={renderItem}
        isExpanded
        onToggleExpanded={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByTestId('conv-c1')).toBeInTheDocument();
    expect(screen.getByTestId('conv-c2')).toBeInTheDocument();
    expect(screen.getByTestId('conv-c3')).toBeInTheDocument();
  });

  it('flags the item immediately BEFORE the hovered one as "next item hovered" (baseline DateGroup.jsx:20-26 semantics)', () => {
    const conversations = [mkConversation({ id: 'c1' }), mkConversation({ id: 'c2' })];
    renderWithTheme(
      <DateGroup
        group={{ name: 'today', displayName: 'Today', conversations }}
        renderConversationItem={renderItem}
        isExpanded
        onToggleExpanded={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    expect(screen.getByTestId('conv-c1')).not.toHaveTextContent('next-hovered');
    fireEvent.mouseEnter(screen.getByTestId('conv-c2'));
    expect(screen.getByTestId('conv-c1')).toHaveTextContent('next-hovered');

    fireEvent.mouseLeave(screen.getByTestId('conv-c2'));
    expect(screen.getByTestId('conv-c1')).not.toHaveTextContent('next-hovered');
  });

  it('renders loading skeleton rows while isLoadingMore is true', () => {
    const { getAllByTestId } = renderWithTheme(
      <DateGroup
        group={{ name: 'today', displayName: 'Today', conversations: [] }}
        renderConversationItem={renderItem}
        isExpanded
        onToggleExpanded={vi.fn()}
        onLoadMore={vi.fn()}
        isLoadingMore
      />,
    );
    expect(getAllByTestId('date-group-skeleton')).toHaveLength(3);
  });

  it('does NOT call getDropAreaState — the baseline computes it and never applies it to any rendered element (dead code, not ported)', () => {
    const getDropAreaState = vi.fn<(id: string) => DropAreaState>(() => ({ isValidDropTarget: true, isActive: true }));
    renderWithTheme(
      <DateGroup
        group={{ name: 'today', displayName: 'Today', conversations: [] }}
        renderConversationItem={renderItem}
        enableDragAndDrop
        getDropAreaState={getDropAreaState}
        isExpanded
        onToggleExpanded={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(getDropAreaState).not.toHaveBeenCalled();
  });

  it('renders no droppable wrapper of its own around the group content — that markup lives only in DroppableGroupedArea', () => {
    const { container } = renderWithTheme(
      <DateGroup
        group={{ name: 'today', displayName: 'Today', conversations: [] }}
        renderConversationItem={renderItem}
        enableDragAndDrop
        getDropAreaState={() => ({ isValidDropTarget: true, isActive: true })}
        isExpanded
        onToggleExpanded={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="drop-feedback-overlay"]')).toBeNull();
    expect(container.querySelector('[data-testid="passive-highlight-overlay"]')).toBeNull();
    expect(container.querySelector('[data-testid="invalid-target-overlay"]')).toBeNull();
  });

  /*
   * The group label is the accessible label of its toggle BUTTON, not a
   * section heading. MUI maps `subtitle2` to `<h6>` by default, which put an
   * h6 beside the folder accordions' `<h3>` summaries — axe `heading-order`,
   * impact "moderate", the moment this list was first mounted on a route.
   */
  it('renders the group label as a button label, not a heading', () => {
    renderWithTheme(
      <DateGroup
        group={{ name: 'today', displayName: 'Today', conversations: [] }}
        renderConversationItem={renderItem}
        isExpanded
        onToggleExpanded={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
  });
});
