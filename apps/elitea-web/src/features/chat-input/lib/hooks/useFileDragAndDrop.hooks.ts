import type { DragEvent } from 'react';
import { useCallback, useState } from 'react';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/shared/lib/hooks/
 * useFileDragAndDrop.hooks.js` (unit C3, "chat-input" cluster).
 *
 * Same "no other home yet" situation as `useCtrlEnterKeyEventsHandler`
 * (not in any Wave-2 unit's `ownedPaths`, not already ported to
 * `shared/lib/`) — kept local to this feature slice for its one consumer,
 * `UserInput.tsx`.
 */
export function useFileDragAndDrop(onDropHandler?: (event: DragEvent<HTMLDivElement>) => void): {
  readonly isDragOver: boolean;
  readonly handleDragOver: (event: DragEvent<HTMLDivElement>) => void;
  readonly handleDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  readonly handleDrop: (event: DragEvent<HTMLDivElement>) => void;
} {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isDragOver) setIsDragOver(true);
    },
    [isDragOver],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const relatedTarget = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(relatedTarget)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
      onDropHandler?.(event);
    },
    [onDropHandler],
  );

  return { isDragOver, handleDragOver, handleDragLeave, handleDrop };
}
