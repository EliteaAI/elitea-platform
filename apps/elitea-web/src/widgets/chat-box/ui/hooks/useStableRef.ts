/**
 * Split out of `ChatBox.tsx` to stay under the component-scoped use-effects
 * budget (§3.5, counted per enclosing PascalCase component — a lowercase
 * hook's own internal `useEffect` isn't attributed to its caller) — a
 * ref that always holds the latest value, for callbacks
 * (`useImperativeHandle`, stable event handlers) that must read fresh state
 * without being recreated on every change.
 */
import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

export function useStableRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
