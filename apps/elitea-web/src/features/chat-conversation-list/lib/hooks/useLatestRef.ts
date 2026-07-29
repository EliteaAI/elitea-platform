import { useRef } from 'react';
import type { RefObject } from 'react';

/**
 * No baseline equivalent — a small, generic extraction of the "ref-mirroring
 * idiom" `useQueryFoldersList.hooks.ts`'s own module doc already establishes
 * for this codebase ("assign `ref.current = value` directly in the render
 * body... synchronously current... this codebase's own precedent for
 * exactly this... need"). Introduced here because THIS unit's own
 * `Conversations.tsx`/`Conversations.renderers.tsx`/`useDragAndDrop.ts` each
 * independently hit the identical shape (bundle every render-prop-callback
 * input into one ref, to bring a `useCallback`'s own dependency array under
 * the §3.5 `hook-deps` budget of 8) — factored out once rather than
 * hand-writing the same "declare a `useRef`, then immediately reassign
 * `.current` to the same object literal" pair 3 times over.
 *
 * Safe ONLY for consumers who read `.current` synchronously within the same
 * render pass that produced it (a later render-prop invocation, an event
 * handler that fires after a future render) — never for a value a caller
 * needs to react to CHANGING (that's what `useEffect`'s own dependency array
 * is for).
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
