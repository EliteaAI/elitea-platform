import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

/**
 * Local port of `apps/elitea-ui/src/hooks/useAgentEditorPanelFit.js` —
 * `AgentEditorPanel.tsx`'s one consumer. No port anywhere else reachable
 * (not `entities/`, not `shared/`) — a small, pure `ResizeObserver`-width
 * hook kept local to this feature slice, per this unit's own task brief
 * ("build small local versions in this unit's own lib/", matching
 * `features/agents/lib/useHasPermission.ts`'s established precedent for
 * why a shared copy isn't worth threading through for one call site).
 *
 * Measures the chat-controls container (the ref'd element's grandparent —
 * baseline comment, preserved: "Structure: ButtonGroup -> Box (right side)
 * -> Box (chat controls)") against a fixed pixel threshold to decide
 * icon-only vs full-text view.
 */
const CHAT_CONTROLS_WIDTH_THRESHOLD = 430;

function measure(container: HTMLElement | null): number | undefined {
  const chatControlsContainer = container?.parentElement?.parentElement;
  return (chatControlsContainer ?? container?.parentElement)?.offsetWidth;
}

export function useAgentEditorPanelFit(): {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly isSmallView: boolean;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSmallView, setIsSmallView] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const checkWidth = (): void => {
      const totalControlsWidth = measure(container);
      setIsSmallView(totalControlsWidth !== undefined && totalControlsWidth < CHAT_CONTROLS_WIDTH_THRESHOLD);
    };

    const parentToObserve = container.parentElement?.parentElement ?? container.parentElement ?? container;
    const resizeObserver = new ResizeObserver(checkWidth);
    resizeObserver.observe(parentToObserve);
    checkWidth();

    return () => resizeObserver.disconnect();
  }, []);

  // No dependency array, intentionally — baseline comment preserved: "Run on
  // every render to catch view changes" that don't resize the observed
  // ancestor's box (e.g. an icon/text content-only swap).
  useEffect(() => {
    if (!containerRef.current) return;

    const timer = setTimeout(() => {
      const totalControlsWidth = measure(containerRef.current);
      if (totalControlsWidth !== undefined) {
        setIsSmallView(totalControlsWidth < CHAT_CONTROLS_WIDTH_THRESHOLD);
      }
    }, 100);

    return () => clearTimeout(timer);
  });

  return { containerRef, isSmallView };
}
