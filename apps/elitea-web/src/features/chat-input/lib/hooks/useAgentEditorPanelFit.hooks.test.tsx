import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentEditorPanelFit } from './useAgentEditorPanelFit.hooks';

// jsdom has no ResizeObserver — same stub already established at
// features/agents/ui/BaseCardBody.test.tsx for the identical situation.
// `observe()` intentionally does nothing further: this hook's own initial
// `checkWidth()` call (right after `.observe()`) is what these tests
// exercise; a real resize stream would need a browser.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function Harness({ controlsWidth }: { readonly controlsWidth: number }) {
  const { containerRef, isSmallView } = useAgentEditorPanelFit();
  return (
    <div style={{ width: controlsWidth }}>
      <div>
        <div ref={containerRef}>{isSmallView ? 'small' : 'full'}</div>
      </div>
    </div>
  );
}

describe('useAgentEditorPanelFit', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports small view when the chat-controls container has no measurable width (jsdom default)', () => {
    render(<Harness controlsWidth={0} />);
    expect(screen.getByText('small')).toBeInTheDocument();
  });

  it('reports full view once the grandparent is wide enough', () => {
    // jsdom never lays out real geometry, so `offsetWidth` must be stubbed
    // directly on the element the hook actually reads (container's
    // grandparent) to simulate a wide chat-controls row.
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
    try {
      render(<Harness controlsWidth={800} />);
      expect(screen.getByText('full')).toBeInTheDocument();
    } finally {
      if (originalDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalDescriptor);
    }
  });
});
