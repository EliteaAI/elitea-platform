import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation } from '@/entities/conversation';

import { renderWithProviders } from '../../__tests__/testUtils';
import type { FolderListItem } from '../../lib/hooks/conversationListState.types';
import { FolderAccordionItem } from './FolderAccordionItem';

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(isIntersecting: boolean): void {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this);
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mkConversation(overrides: Partial<Conversation> & { readonly id: string }): Conversation {
  return { name: overrides.id, isPrivate: false, ...overrides };
}

function mkFolder(overrides: Partial<FolderListItem> & { readonly id: string; readonly conversations: readonly Conversation[] }): FolderListItem {
  return { name: overrides.id, ...overrides };
}

function stubRenderConversationItem(conversation: Conversation) {
  return <div key={conversation.id} data-testid={`conversation-${conversation.id}`}>{conversation.name}</div>;
}

describe('FolderAccordionItem', () => {
  it('renders the empty state when the folder has no conversations', () => {
    renderWithProviders(
      <FolderAccordionItem
        folder={mkFolder({ id: 'f1', conversations: [] })}
        renderConversationItem={stubRenderConversationItem}
      />,
    );
    expect(screen.getByText('No conversations added')).toBeInTheDocument();
  });

  it('renders one item per conversation via renderConversationItem, sorted by updatedAt descending', () => {
    const older = mkConversation({ id: 'older', updatedAt: '2024-01-01T00:00:00.000Z' });
    const newer = mkConversation({ id: 'newer', updatedAt: '2024-06-01T00:00:00.000Z' });
    renderWithProviders(
      <FolderAccordionItem
        folder={mkFolder({ id: 'f1', conversations: [older, newer] })}
        renderConversationItem={stubRenderConversationItem}
      />,
    );
    const rendered = screen.getAllByTestId(/^conversation-/);
    expect(rendered.map((el) => el.dataset['testid'])).toEqual(['conversation-newer', 'conversation-older']);
  });

  it('falls back to createdAt when updatedAt is absent, still sorting descending', () => {
    const older = mkConversation({ id: 'older', createdAt: '2024-01-01T00:00:00.000Z' });
    const newer = mkConversation({ id: 'newer', createdAt: '2024-06-01T00:00:00.000Z' });
    renderWithProviders(
      <FolderAccordionItem
        folder={mkFolder({ id: 'f1', conversations: [older, newer] })}
        renderConversationItem={stubRenderConversationItem}
      />,
    );
    const rendered = screen.getAllByTestId(/^conversation-/);
    expect(rendered.map((el) => el.dataset['testid'])).toEqual(['conversation-newer', 'conversation-older']);
  });

  it('renders loading skeletons while isLoadingMore is true', () => {
    const { getAllByTestId } = renderWithProviders(
      <FolderAccordionItem
        folder={mkFolder({ id: 'f1', conversations: [mkConversation({ id: 'c1' })], total: 10 })}
        renderConversationItem={stubRenderConversationItem}
        isLoadingMore
      />,
    );
    expect(getAllByTestId('folder-accordion-item-skeleton')).toHaveLength(3);
  });

  it('renders a load-more sentinel and calls onLoadMore when it intersects, using folder.total as totalAvailableCount', () => {
    const onLoadMore = vi.fn();
    renderWithProviders(
      <FolderAccordionItem
        folder={mkFolder({ id: 'f1', conversations: [mkConversation({ id: 'c1' })], total: 5 })}
        renderConversationItem={stubRenderConversationItem}
        onLoadMore={onLoadMore}
      />,
    );
    expect(MockIntersectionObserver.instances).toHaveLength(1);
    MockIntersectionObserver.instances[0]?.trigger(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not render a load-more sentinel when every conversation is already loaded (folder.total defaults to 0)', () => {
    renderWithProviders(
      <FolderAccordionItem
        folder={mkFolder({ id: 'f1', conversations: [mkConversation({ id: 'c1' })] })}
        renderConversationItem={stubRenderConversationItem}
      />,
    );
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });
});
