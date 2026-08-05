import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../__tests__/testUtils';
import type { FolderListItem } from '../../lib/hooks/conversationListState.types';
import { DroppableFolderItem } from './DroppableFolderItem';

function mkFolder(overrides: Partial<FolderListItem> & { readonly id: string }): FolderListItem {
  return { name: overrides.id, conversations: [], ...overrides };
}

describe('DroppableFolderItem', () => {
  it('renders its children', () => {
    renderWithProviders(<DroppableFolderItem folder={mkFolder({ id: 'f1' })}>child content</DroppableFolderItem>);
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('renders no overlay when no drag is active (isActive=false)', () => {
    renderWithProviders(
      <DroppableFolderItem
        folder={mkFolder({ id: 'f1' })}
        isActive={false}
      >
        child
      </DroppableFolderItem>,
    );
    expect(screen.queryByTestId('droppable-folder-item-drop-feedback')).not.toBeInTheDocument();
    expect(screen.queryByTestId('droppable-folder-item-hover-ring')).not.toBeInTheDocument();
    expect(screen.queryByTestId('droppable-folder-item-dimmed-invalid')).not.toBeInTheDocument();
  });

  it('renders the passive highlight ring for a valid target while a drag is active but not hovering', () => {
    renderWithProviders(
      <DroppableFolderItem
        folder={mkFolder({ id: 'f1' })}
        isActive
        isValidDropTarget
      >
        child
      </DroppableFolderItem>,
    );
    expect(screen.getByTestId('droppable-folder-item-hover-ring')).toBeInTheDocument();
    expect(screen.queryByTestId('droppable-folder-item-drop-feedback')).not.toBeInTheDocument();
    expect(screen.queryByTestId('droppable-folder-item-dimmed-invalid')).not.toBeInTheDocument();
  });

  it('renders the dimmed-invalid overlay for an active drag over a folder that is NOT a valid drop target', () => {
    renderWithProviders(
      <DroppableFolderItem
        folder={mkFolder({ id: 'f1' })}
        isActive
        isValidDropTarget={false}
      >
        child
      </DroppableFolderItem>,
    );
    expect(screen.getByTestId('droppable-folder-item-dimmed-invalid')).toBeInTheDocument();
    expect(screen.queryByTestId('droppable-folder-item-drop-feedback')).not.toBeInTheDocument();
    expect(screen.queryByTestId('droppable-folder-item-hover-ring')).not.toBeInTheDocument();
  });

  it('never renders the drop-feedback overlay outside a real @dnd-kit hover (isOver), even when isActive+isValidDropTarget are both true', () => {
    // `isOver` comes only from `useDroppable` itself (real drag-over state);
    // this component's own props can never force it — see this file's own
    // module doc. Real hover-state coverage is out of reach in jsdom (no
    // layout for pointer-path collision geometry, same limitation `src/
    // smoke/dndkit.smoke.test.tsx` documents), so this test only proves the
    // negative: no active real drag means no drop-feedback overlay, ever.
    renderWithProviders(
      <DroppableFolderItem
        folder={mkFolder({ id: 'f1' })}
        isActive
        isValidDropTarget
      >
        child
      </DroppableFolderItem>,
    );
    expect(screen.queryByTestId('droppable-folder-item-drop-feedback')).not.toBeInTheDocument();
  });
});
