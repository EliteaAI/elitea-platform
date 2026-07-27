import { describe, expect, it } from 'vitest';

import { installCodeMirrorTestPolyfills } from './codeMirrorTestPolyfills';

/** Removes `object[key]`, restoring its exact original property descriptor (or removing it again) once `run` finishes — avoids the `typescript/unbound-method` lint that a bare `const original = object.method` extraction triggers. */
function withPropertyRemoved(object: object, key: PropertyKey, run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  // eslint-disable-next-line typescript/no-dynamic-delete -- test-only, key is always a known literal from the call sites below.
  delete (object as Record<PropertyKey, unknown>)[key];
  try {
    run();
  } finally {
    if (descriptor) {
      Object.defineProperty(object, key, descriptor);
    }
  }
}

describe('installCodeMirrorTestPolyfills', () => {
  it('installs Range.prototype.getClientRects when jsdom has none', () => {
    withPropertyRemoved(Range.prototype, 'getClientRects', () => {
      installCodeMirrorTestPolyfills();
      const range = document.createRange();
      expect(range.getClientRects().length).toBe(0);
    });
  });

  it('installs Range.prototype.getBoundingClientRect when jsdom has none', () => {
    withPropertyRemoved(Range.prototype, 'getBoundingClientRect', () => {
      installCodeMirrorTestPolyfills();
      const range = document.createRange();
      const rect = range.getBoundingClientRect();
      expect(rect.width).toBe(0);
      expect(rect.height).toBe(0);
    });
  });

  it('installs window.ResizeObserver when undefined', () => {
    withPropertyRemoved(window, 'ResizeObserver', () => {
      installCodeMirrorTestPolyfills();
      expect(typeof window.ResizeObserver).toBe('function');
      const observer = new window.ResizeObserver(() => {});
      // The no-op stub must not throw on any of the three calls a real
      // consumer (`ResizableCodeMirrorEditor`'s effect) makes.
      expect(() => {
        observer.observe(document.body);
        observer.unobserve(document.body);
        observer.disconnect();
      }).not.toThrow();
    });
  });

  it('does not overwrite an already-present implementation (real browser / already-polyfilled)', () => {
    const sentinelRects = () => [] as unknown as DOMRectList;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Range.prototype.getClientRects = sentinelRects;
    try {
      installCodeMirrorTestPolyfills();
      const current = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')?.value as unknown;
      expect(current).toBe(sentinelRects);
    } finally {
      if (originalDescriptor) Object.defineProperty(Range.prototype, 'getClientRects', originalDescriptor);
    }
  });

  it('is safe to call more than once', () => {
    expect(() => {
      installCodeMirrorTestPolyfills();
      installCodeMirrorTestPolyfills();
    }).not.toThrow();
  });
});
