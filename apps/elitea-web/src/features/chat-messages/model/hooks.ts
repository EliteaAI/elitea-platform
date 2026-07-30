/**
 * Ported from `apps/elitea-ui/src/components/Chat/hooks.js` — small
 * utility hooks for the Chat cluster.
 *
 * Port of `apps/elitea-ui/src/components/Chat/hooks.js`.
 */
import { useEffect, useRef, useState } from 'react';

/**
 * `usePrevious` — returns the previous value of a prop/state.
 *
 * Port of `apps/elitea-ui/src/components/Chat/hooks.js:1-5` `usePrevious`.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

/**
 * `useDebounce` — debounces a value with the given delay.
 *
 * Port of `apps/elitea-ui/src/components/Chat/hooks.js` `useDebounce`.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * `useOutsideClick` — detects clicks outside a ref'd element.
 *
 * Port of `apps/elitea-ui/src/components/Chat/hooks.js` `useOutsideClick`.
 */
export function useOutsideClick<T extends HTMLElement>(ref: React.RefObject<T>, handler: () => void): void {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      handler();
    };

    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);

    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}
