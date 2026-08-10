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

    /*
     * The activator is queried by role `group`, not dnd-kit's default
     * `button` (`@dnd-kit/core`'s own `defaultRole`). `lib/dragAttributes.ts`
     * re-roles it: this container wraps the folder row's own buttons, so
     * claiming to BE a button made every row an axe `nested-interactive`
     * violation. `group` is not a widget role, so focusable descendants are
     * fine.
     *
     * The assertion below is what proves the re-role did not cost anything:
     * a REAL KeyboardSensor drag still lifts the item. dnd-kit activates from
     * a keydown on the focused activator node, so `tabIndex` (kept) is what
     * matters, not `role` (changed).
     */
    const activator = screen.getByRole('group');
    expect(activator, 'the drag container must not claim to be a button — it wraps the row\'s own buttons').not.toHaveAttribute('role', 'button');
    activator.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('draggable-folder-item-overlay')).toBeInTheDocument();
  });

  it('does not present the drag container as a nested interactive widget', () => {
    renderWithProviders(<DraggableFolderItem folder={mkFolder({ id: 'f1' })}>child</DraggableFolderItem>);
    const container = screen.getByText('child').closest('[aria-disabled]');
    expect(container).toHaveAttribute('role', 'group');
    // Kept, and load-bearing: without a tab stop the KeyboardSensor above
    // cannot be reached at all.
    expect(container).toHaveAttribute('tabindex', '0');
    // `aria-pressed` is a toggle-button state; it is not allowed on a group.
    expect(container).not.toHaveAttribute('aria-pressed');
  });
});
