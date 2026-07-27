import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * D3 / spec §11 Q6 — Wave-0 React 19 smoke test for @dnd-kit/core@6.3.1
 * (peers `react >=16.8.0`, does not declare 19). If this file fails, the
 * pre-approved fallback applies: @atlaskit/pragmatic-drag-and-drop, confined
 * to unit C2.
 *
 * The interaction is driven through the KeyboardSensor (Enter to lift, arrow
 * to move, Enter to drop) because jsdom performs no layout — pointer-path
 * collision geometry is a browser-project concern. What this proves is the
 * React 19 compatibility surface: sensor activation, context state updates,
 * drag lifecycle callbacks firing end-to-end.
 */

function DraggableCard() {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: 'card-1' });
  return (
    <button type="button" ref={setNodeRef} {...listeners} {...attributes} data-dragging={transform !== null}>
      draggable card
    </button>
  );
}

function DropZone() {
  const { setNodeRef } = useDroppable({ id: 'zone-1' });
  return <output ref={setNodeRef}>drop zone</output>;
}

function Board({
  onDragStart,
  onDragEnd,
}: {
  onDragStart: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  const sensors = useSensors(useSensor(KeyboardSensor));
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <DraggableCard />
      <DropZone />
    </DndContext>
  );
}

describe('@dnd-kit/core@6.3.1 under React 19.2.8', () => {
  it('runs a keyboard drag interaction through the full lifecycle', async () => {
    const user = userEvent.setup();
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn<(event: DragEndEvent) => void>();

    render(<Board onDragStart={onDragStart} onDragEnd={onDragEnd} />);

    const card = screen.getByRole('button', { name: 'draggable card' });

    // dnd-kit's accessibility contract: draggables advertise themselves.
    expect(card.getAttribute('aria-roledescription')).toBe('draggable');

    card.focus();
    await user.keyboard('{Enter}'); // lift
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(card.getAttribute('aria-pressed')).toBe('true');

    await user.keyboard('{ArrowDown}'); // move
    await user.keyboard('{Enter}'); // drop
    expect(onDragEnd).toHaveBeenCalledTimes(1);

    // The move leg is observable even in jsdom: KeyboardSensor's default
    // coordinate getter shifts 25px per arrow press, so one ArrowDown lands
    // the drop at delta {x:0, y:25}.
    expect(onDragEnd.mock.calls[0]?.[0]?.delta).toMatchObject({ x: 0, y: 25 });
  });
});
