/**
 * Drag-to-resize for a right-hand drawer, as a hook with the DOM in one place.
 *
 * SEPARATE FROM THE COMPONENT because the arithmetic is the part that can be
 * wrong and the part nobody can see. The width is derived from the pointer's
 * distance to the RIGHT edge of the window, clamped; get the sign wrong and the
 * drawer grows when you drag it closed, which no snapshot catches and no render
 * test reaches.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DrawerResizeOptions {
  readonly initialWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  /** The window width, injected so the arithmetic is testable. */
  readonly viewportWidth?: () => number;
}

export interface DrawerResize {
  readonly width: number;
  readonly isResizing: boolean;
  readonly startResize: () => void;
  /** Widen or narrow by a step, clamped. The keyboard's path to the same thing. */
  readonly nudge: (delta: number) => void;
}

/**
 * The width a pointer at `clientX` asks for, clamped to the bounds.
 *
 * Exported for its own test: it is pure, and it is the whole behaviour.
 */
export function widthForPointer(
  clientX: number,
  viewportWidth: number,
  minWidth: number,
  maxWidth: number,
): number {
  // The drawer is anchored RIGHT, so its width is the distance from the pointer
  // to the right edge. Subtracting the other way makes the drawer shrink as it
  // is dragged open.
  const requested = viewportWidth - clientX;
  return Math.min(Math.max(requested, minWidth), maxWidth);
}

export function useDrawerResize(options: DrawerResizeOptions): DrawerResize {
  const [width, setWidth] = useState(options.initialWidth);
  const [isResizing, setIsResizing] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const startResize = useCallback(() => {
    setIsResizing(true);
  }, []);

  // The KEYBOARD path, and it is not decoration: a drag handle a keyboard user
  // cannot reach makes the drawer's width a mouse-only setting, and this one
  // spans a third of the window.
  const nudge = useCallback((delta: number) => {
    const { minWidth, maxWidth } = optionsRef.current;
    setWidth((current) => Math.min(Math.max(current + delta, minWidth), maxWidth));
  }, []);

  useEffect(() => {
    if (!isResizing) return undefined;

    const onMove = (event: MouseEvent): void => {
      const { minWidth, maxWidth, viewportWidth } = optionsRef.current;
      setWidth(widthForPointer(event.clientX, (viewportWidth ?? (() => window.innerWidth))(), minWidth, maxWidth));
    };
    const onUp = (): void => {
      setIsResizing(false);
    };

    // On the DOCUMENT, not on the handle: a fast drag outruns the pointer and
    // leaves the handle behind, and a handle-scoped listener then stops
    // receiving moves while the button is still held — the drawer sticks
    // mid-drag and only a click elsewhere frees it.
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isResizing]);

  return { width, isResizing, startResize, nudge };
}
