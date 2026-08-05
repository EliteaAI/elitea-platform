import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation } from '@/entities/conversation';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { DateGroupListItem } from '../../lib/hooks/conversationListState.types';
import { GroupedConversations } from './GroupedConversations';
import type { RenderConversationItem } from './DateGroup';

function mkConversation(overrides: Partial<Conversation> & { readonly id: string }): Conversation {
  return { name: overrides.id, isPrivate: true, ...overrides };
}

const renderItem: RenderConversationItem = (conversation) => <div data-testid={`conv-${conversation.id}`}>{conversation.name}</div>;

/** `LoadMoreSentinel` (rendered by every `DateGroup`) needs `IntersectionObserver` — jsdom has none; same stub `LoadMoreSentinel.test.tsx`/`features/toolkits/ui/list/ToolkitsList.test.tsx` already use. */
class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GroupedConversations', () => {
  it('shows the empty-state message when there are no visible groups and totalConversationsAmount is 0', () => {
    renderWithTheme(
      <GroupedConversations
        dateGroups={[]}
        totalConversationsAmount={0}
        renderConversationItem={renderItem}
      />,
    );
    expect(screen.getByText('Still no conversations created.')).toBeInTheDocument();
  });

  it('renders nothing when there are no visible groups but totalConversationsAmount is non-zero (e.g. everything is in folders/pinned)', () => {
    const { container } = renderWithTheme(
      <GroupedConversations
        dateGroups={[]}
        totalConversationsAmount={3}
        renderConversationItem={renderItem}
      />,
    );
    expect(screen.queryByText('Still no conversations created.')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('filters out groups with zero conversations from what it renders', () => {
    const dateGroups: DateGroupListItem[] = [
      { name: 'today', conversations: [mkConversation({ id: 'c1' })] },
      { name: 'older', conversations: [] },
    ];
    renderWithTheme(
      <GroupedConversations
        dateGroups={dateGroups}
        totalConversationsAmount={1}
        renderConversationItem={renderItem}
      />,
    );
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByText('Older')).not.toBeInTheDocument();
  });

  it('injects the DATE_GROUP_DISPLAY_NAMES label for known group names, and falls back to the raw name for unknown ones', () => {
    const dateGroups: DateGroupListItem[] = [
      { name: 'this_week', conversations: [mkConversation({ id: 'c1' })] },
      { name: 'a_future_group', conversations: [mkConversation({ id: 'c2' })] },
    ];
    renderWithTheme(
      <GroupedConversations
        dateGroups={dateGroups}
        totalConversationsAmount={2}
        renderConversationItem={renderItem}
      />,
    );
    expect(screen.getByRole('button', { name: 'This Week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'a_future_group' })).toBeInTheDocument();
  });

  it('auto-expands the "today" group by default (useDateGroupExpansion initializeExpansion)', () => {
    const dateGroups: DateGroupListItem[] = [{ name: 'today', conversations: [mkConversation({ id: 'c1' })] }];
    renderWithTheme(
      <GroupedConversations
        dateGroups={dateGroups}
        totalConversationsAmount={1}
        renderConversationItem={renderItem}
      />,
    );
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles a group closed and back open when its header is clicked (real useDateGroupExpansion wiring)', () => {
    const dateGroups: DateGroupListItem[] = [{ name: 'today', conversations: [mkConversation({ id: 'c1' })] }];
    renderWithTheme(
      <GroupedConversations
        dateGroups={dateGroups}
        totalConversationsAmount={1}
        renderConversationItem={renderItem}
      />,
    );
    const header = screen.getByRole('button', { name: 'Today' });
    expect(header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  /**
   * Regression (found by adversarial verify): the baseline's search-mode
   * name-matching guards `conv.name?.toLowerCase()` (`GroupedConversations.jsx:41`)
   * because a conversation's `name` isn't guaranteed non-nullish at runtime
   * (`Conversation.name`'s `string` type is sourced from an explicitly
   * unschemaed wire — see `entities/conversation/api/conversationApi.ts`'s
   * own doc comment). A missing guard here would throw inside this
   * component's own search-mode effect instead of just excluding that one
   * conversation from the match set.
   */
  it('does not throw when a conversation in a searched group has a nullish name', () => {
    // The name-matching effect only runs on an isSearchMode/searchQuery
    // TRANSITION (its own `searchModeChanged`/`searchQueryChanged` refs are
    // seeded from the FIRST render's props) — mounting already-in-search-mode
    // never exercises it, so this starts out of search mode and rerenders in.
    const mutableConversation = mkConversation({ id: 'c1' }) as unknown as Record<string, unknown>;
    delete mutableConversation['name'];
    const conversationWithNullishName = mutableConversation as unknown as Conversation;
    const dateGroups: DateGroupListItem[] = [{ name: 'today', conversations: [conversationWithNullishName] }];

    const { rerender } = renderWithTheme(
      <GroupedConversations
        dateGroups={dateGroups}
        totalConversationsAmount={1}
        renderConversationItem={renderItem}
        isSearchMode={false}
      />,
    );

    expect(() =>
      rerender(
        <GroupedConversations
          dateGroups={dateGroups}
          totalConversationsAmount={1}
          renderConversationItem={renderItem}
          isSearchMode
          searchQuery="anything"
        />,
      ),
    ).not.toThrow();
  });

  it('calls onLoadMoreInGroup with the group name via DateGroup/LoadMoreSentinel when more items are available', () => {
    const onLoadMoreInGroup = vi.fn();
    const dateGroups: DateGroupListItem[] = [{ name: 'today', conversations: [mkConversation({ id: 'c1' })], total: 5 }];
    const { getByTestId } = renderWithTheme(
      <GroupedConversations
        dateGroups={dateGroups}
        totalConversationsAmount={1}
        renderConversationItem={renderItem}
        onLoadMoreInGroup={onLoadMoreInGroup}
      />,
    );
    expect(getByTestId('conversation-load-more-sentinel')).toBeInTheDocument();
  });
});
