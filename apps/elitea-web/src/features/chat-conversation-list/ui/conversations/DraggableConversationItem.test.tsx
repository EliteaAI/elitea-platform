import { DndContext } from '@dnd-kit/core';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Conversation } from '@/entities/conversation';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { DraggableConversationItem } from './DraggableConversationItem';

const conversation: Conversation = { id: 'conv-1', name: 'Conv 1', isPrivate: true };

describe('DraggableConversationItem', () => {
  it('renders its children', () => {
    renderWithTheme(
      <DndContext>
        <DraggableConversationItem conversation={conversation}>
          <span>row content</span>
        </DraggableConversationItem>
      </DndContext>,
    );
    expect(screen.getByText('row content')).toBeInTheDocument();
  });

  it('advertises itself as a draggable element (dnd-kit a11y contract) when not disabled', () => {
    renderWithTheme(
      <DndContext>
        <DraggableConversationItem conversation={conversation}>
          <span>row content</span>
        </DraggableConversationItem>
      </DndContext>,
    );
    expect(screen.getByText('row content').closest('[aria-roledescription="draggable"]')).not.toBeNull();
  });

  it('applies the active-conversation class when isActive is true', () => {
    renderWithTheme(
      <DndContext>
        <DraggableConversationItem
          conversation={conversation}
          isActive
        >
          <span>row content</span>
        </DraggableConversationItem>
      </DndContext>,
    );
    expect(screen.getByText('row content').closest('.active-conversation')).not.toBeNull();
  });

  it('does not apply the active-conversation class by default', () => {
    renderWithTheme(
      <DndContext>
        <DraggableConversationItem conversation={conversation}>
          <span>row content</span>
        </DraggableConversationItem>
      </DndContext>,
    );
    expect(screen.getByText('row content').closest('.active-conversation')).toBeNull();
  });
});
