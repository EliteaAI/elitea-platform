import { DndContext, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../__tests__/testUtils';
import type { FolderListItem } from '../../lib/hooks/conversationListState.types';
import { DraggableFolderItem } from './DraggableFolderItem';

function mkFolder(overrides: Partial<FolderListItem> & { readonly id: string }): FolderListItem {
  return { name: overrides.id, conversations: [], ...overrides };
}

describe('DraggableFolderItem', () => {
  it('renders its children', () => {
    renderWithProviders(<DraggableFolderItem folder={mkFolder({ id: 'f1' })}>child content</DraggableFolderItem>);
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('is aria-disabled when isDragDisabled is set', () => {
    renderWithProviders(
      <DraggableFolderItem
        folder={mkFolder({ id: 'f1' })}
        isDragDisabled
      >
        child
      </DraggableFolderItem>,
    );
    expect(screen.getByText('child').closest('[aria-disabled]')).toHaveAttribute('aria-disabled', 'true');
  });

  it('is aria-disabled for a not-yet-persisted (isNew) folder even without isDragDisabled', () => {
    renderWithProviders(<DraggableFolderItem folder={mkFolder({ id: 'f1', isNew: true })}>child</DraggableFolderItem>);
    expect(screen.getByText('child').closest('[aria-disabled]')).toHaveAttribute('aria-disabled', 'true');
  });

  it('is not aria-disabled by default', () => {
    renderWithProviders(<DraggableFolderItem folder={mkFolder({ id: 'f1' })}>child</DraggableFolderItem>);
    expect(screen.getByText('child').closest('[aria-disabled]')).toHaveAttribute('aria-disabled', 'false');
  });

  it('does not render the drag overlay while not dragging', () => {
    renderWithProviders(<DraggableFolderItem folder={mkFolder({ id: 'f1' })}>child</DraggableFolderItem>);
    expect(screen.queryByTestId('draggable-folder-item-overlay')).not.toBeInTheDocument();
  });

  it('renders the drag overlay once a real keyboard-sensor drag lifts the item', async () => {
    // Same real-DndContext + KeyboardSensor pattern proven by
    // `src/smoke/dndkit.smoke.test.tsx` (D3 / spec §11 Q6) — jsdom has no
    // layout, so pointer-path collision geometry is out of reach, but a
    // keyboard lift genuinely flips `useSortable`'s own `isDragging` state,
    // which is exactly what this component's overlay branch reads.
    function Board() {
      const sensors = useSensors(useSensor(KeyboardSensor));
      return (
        <DndContext sensors={sensors}>
          <SortableContext items={['folder-f1']}>
            <DraggableFolderItem folder={mkFolder({ id: 'f1' })}>child</DraggableFolderItem>
          </SortableContext>
        </DndContext>
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Board />);

    expect(screen.queryByTestId('draggable-folder-item-overlay')).not.toBeInTheDocument();

    // `getByRole('button')` (not `getByText('child').closest(...)`) — the
    // former returns a real `HTMLElement` (so `.focus()` type-checks with no
    // cast); `useSortable`'s default `role` is `'button'` (`@dnd-kit/core`'s
    // own `defaultRole`), matching this query.
    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('draggable-folder-item-overlay')).toBeInTheDocument();
  });
});
