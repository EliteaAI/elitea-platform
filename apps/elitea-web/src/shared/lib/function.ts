/**
 * Generic function helper ported from apps/elitea-ui/src/common/utils.jsx
 * (unit S3, spec §9.3).
 */

/**
 * Trailing-edge debounce: (re)starts a `delay`-ms timer on every call and
 * only invokes `fn` once the calls stop for `delay` ms. Parity (old-app
 * `utils.jsx:129-141`): uses `function ()` + `.apply(this, arguments)` so
 * the debounced wrapper forwards its call-time `this` and arguments to
 * `fn`; ported with the same dynamic-`this` shape rather than an arrow
 * function, since `this`-forwarding is an observable part of the contract
 * (event-handler callers relied on it).
 */
export function debounce<A extends unknown[]>(fn: (this: unknown, ...args: A) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return function debounced(this: unknown, ...args: A): void {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}
