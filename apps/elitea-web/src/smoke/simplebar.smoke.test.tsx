import { type ComponentRef, createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SimpleBar from 'simplebar-react';

/**
 * D3 / spec §11 Q6 — Wave-0 React 19 smoke test for simplebar-react@3.3.2
 * (peers `react >=16.8.0`, does not declare 19). If this file fails, the
 * pre-approved fallback applies: drop the dependency, unit S1 uses native
 * `scrollbar-*` CSS (accepted loss: styled scrollbars on Firefox).
 *
 * jsdom lacks ResizeObserver (a browser API simplebar observes with) — the
 * polyfill below is exactly the R-M1-sanctioned "browser APIs jsdom lacks"
 * category.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub;
}

describe('simplebar-react@3.3.2 under React 19.2.8', () => {
  it('renders children inside its scroll structure', () => {
    render(
      <SimpleBar style={{ maxHeight: 120 }}>
        <ul>
          {Array.from({ length: 50 }, (_, index) => (
            <li key={index}>row {index}</li>
          ))}
        </ul>
      </SimpleBar>,
    );

    expect(screen.getByText('row 0')).toBeDefined();
    expect(screen.getByText('row 49')).toBeDefined();
  });

  it('exposes a live SimpleBar instance whose scroll element accepts scroll state', () => {
    // ComponentRef derives the SimpleBarCore instance type from the component
    // itself, avoiding a direct dependency on transitive simplebar-core.
    const ref = createRef<ComponentRef<typeof SimpleBar>>();
    const onScroll = vi.fn();

    render(
      <SimpleBar ref={ref} style={{ maxHeight: 120 }} onScrollCapture={onScroll}>
        <div style={{ height: 4000 }}>tall content</div>
      </SimpleBar>,
    );

    const instance = ref.current;
    expect(instance).not.toBeNull();

    const scrollElement = instance?.getScrollElement();
    expect(scrollElement).toBeInstanceOf(HTMLElement);

    // Scroll-behaviour sanity: the scroll element holds programmatic scroll
    // state and its scroll events propagate through React without simplebar
    // throwing (jsdom does no layout, so pixel-accurate scrolling is out of
    // scope here — that lives in the browser vitest project when S1 needs it).
    if (scrollElement) {
      scrollElement.scrollTop = 50;
      expect(scrollElement.scrollTop).toBe(50);
      scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    expect(onScroll).toHaveBeenCalled();

    expect(instance?.getContentElement()).toBeInstanceOf(HTMLElement);
  });
});
