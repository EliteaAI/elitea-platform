/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/lib/hooks/useTourCardPosition.hooks.js`
 *
 * Adaptations:
 *  - Imports CARD_WIDTH_PX from the feature's own constants.
 *  - Fully typed with TypeScript.
 *  - No React-Redux or external dependencies — self-contained.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { CARD_WIDTH_PX } from '../constants';

/**
 * Information about the target element's bounding rectangle, used to
 * position the tour card relative to it.
 */
export interface TargetInfo {
  rect: DOMRect;
  borderRadius: string;
}

/**
 * Card position styles derived from the target element's rect.
 * When placement is 'bottom', this object may contain both `positionSx`
 * and `bodySx` (a split shape).
 */
const CARD_GAP_PX = 18;
const CARD_ESTIMATED_HEIGHT_PX = 400;
const VIEWPORT_MARGIN_PX = 16;
const TARGET_SCROLL_MARGIN_PX = 32;
// Fixed vertical space consumed by padding, title, gaps, and footer — everything
// except the scrollable body. Used to compute the maximum body height when the
// card is placed below a target near the bottom of the viewport.
const CARD_CHROME_HEIGHT_PX = 136;

const getViewportSize = (): { vw: number; vh: number } => {
  if (typeof window === 'undefined') {
    return { vw: 0, vh: 0 };
  }

  return { vw: window.innerWidth, vh: window.innerHeight };
};

const isTargetWithinViewport = (rect: DOMRect): boolean => {
  const { vw, vh } = getViewportSize();

  return (
    rect.top >= TARGET_SCROLL_MARGIN_PX &&
    rect.left >= TARGET_SCROLL_MARGIN_PX &&
    rect.bottom <= vh - TARGET_SCROLL_MARGIN_PX &&
    rect.right <= vw - TARGET_SCROLL_MARGIN_PX
  );
};

const getScrollBehavior = (): ScrollBehavior => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'smooth';
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
};

/**
 * Collapses multiple calls within the same animation frame into a single
 * execution of `fn`. Returns `schedule()` to enqueue and `cancel()` to abort.
 */
const createRafThrottle = (fn: () => void): { schedule: () => void; cancel: () => void } => {
  let rafId: number | null = null;

  return {
    schedule() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        fn();
      });
    },
    cancel() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
};

/**
 * Tracks the bounding rect of a tour step's target element and derives the
 * card's fixed position, keeping both in sync with scroll, viewport resize, and
 * target element resize.
 *
 * @param {object|null} currentStep — the current step from the tour controller
 * @returns {{ targetInfo: TargetInfo|null, cardPositionSx: object, cardBodySx: object|null }}
 */
export const useTourCardPosition = (currentStep: {
  target?: string;
  placement?: string;
  scrollBlock?: string;
} | null): {
  targetInfo: TargetInfo | null;
  cardPositionSx: Record<string, unknown>;
  cardBodySx: Record<string, unknown> | null;
} => {
  const [targetInfo, setTargetInfo] = useState<TargetInfo | null>(null);

  // Viewport dimensions as state so cardPositionSx re-runs on resize even when
  // the target element's own rect hasn't changed (e.g. a fixed-position sidebar).
  const [viewport, setViewport] = useState(getViewportSize);

  const measureElement = useCallback((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    // getComputedStyle returns '0px' (truthy) when no radius is set, so check
    // for zero explicitly and fall back to the design-spec default (12px).
    const computed = getComputedStyle(el).borderRadius;
    const borderRadius = !computed || computed === '0px' ? '0.75rem' : computed;

    setTargetInfo({ rect, borderRadius });
  }, []);

  // Viewport dimensions only change on window resize — update them separately
  // so scroll events don't create unnecessary re-renders.
  const updateViewport = useCallback(() => {
    setViewport(prev => {
      const { vw, vh } = getViewportSize();

      return prev.vw === vw && prev.vh === vh ? prev : { vw, vh };
    });
  }, []);

  useEffect(() => {
    if (!currentStep?.target) {
      setTargetInfo(null);
      return;
    }

    let observedEl: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;

    // Queries the selector, attaches a ResizeObserver to the (possibly new)
    // element, measures it, and scrolls it into view when necessary.
    // All three responsibilities live here to keep the logic sequential and
    // avoid the forward-reference tangle that separate helpers would require.
    const measureTarget = () => {
      const el = document.querySelector(currentStep.target!) as HTMLElement | null;

      if (!el) {
        resizeObserver?.disconnect();
        resizeObserver = null;
        observedEl = null;
        setTargetInfo(null);
        return;
      }

      if (observedEl !== el) {
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(throttle.schedule);
        resizeObserver.observe(el);
        observedEl = el;
      }

      measureElement(el);

      if (!isTargetWithinViewport(el.getBoundingClientRect())) {
        el.scrollIntoView({
          behavior: getScrollBehavior(),
          block: (currentStep?.scrollBlock as ScrollLogicalPosition) ?? 'center',
          inline: 'nearest',
        });
      }
    };

    // Throttle re-measurement to one rAF tick to avoid layout thrash while
    // handling scroll/resize events and while waiting for late-mounted targets.
    const throttle = createRafThrottle(measureTarget);

    const handleResize = () => {
      throttle.schedule();
      updateViewport();
    };

    // MutationObserver re-queries the selector when the DOM changes, which
    // handles targets that mount after the step becomes active (e.g. a modal).
    // childList + subtree is enough — we only need to react to nodes being added
    // or removed, not attribute changes (which fire constantly in React apps).
    const mutationObserver = new MutationObserver(throttle.schedule);

    // Capture phase catches scroll on any scrollable ancestor.
    window.addEventListener('scroll', throttle.schedule, { capture: true, passive: true });
    window.addEventListener('resize', handleResize, { passive: true });

    if (document.body) {
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    throttle.schedule();

    return () => {
      window.removeEventListener('scroll', throttle.schedule, { capture: true });
      window.removeEventListener('resize', handleResize);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      throttle.cancel();
    };
  }, [currentStep?.target, currentStep?.placement, currentStep?.scrollBlock, measureElement, updateViewport]);

  const cardPositionSx = useMemo<Record<string, unknown>>(() => {
    if (!targetInfo || !currentStep || currentStep.placement === 'center') {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }

    const placement = currentStep.placement;
    // placement is guaranteed string here (center/undefined already handled above)

    const { rect } = targetInfo;
    const { vw, vh } = viewport;

    const clampLeft = (x: number) => Math.max(VIEWPORT_MARGIN_PX, Math.min(x, vw - CARD_WIDTH_PX - VIEWPORT_MARGIN_PX));

    const verticalTop = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(rect.top, vh - CARD_ESTIMATED_HEIGHT_PX - VIEWPORT_MARGIN_PX),
    );

    const centeredTop = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(
        rect.top + rect.height / 2 - CARD_ESTIMATED_HEIGHT_PX / 2,
        vh - CARD_ESTIMATED_HEIGHT_PX - VIEWPORT_MARGIN_PX,
      ),
    );

    switch (placement) {
      case 'center':
        return {
          top: centeredTop,
          left: clampLeft(rect.left + rect.width / 2 - CARD_WIDTH_PX / 2),
        };
      case 'left':
        return { top: verticalTop, left: clampLeft(rect.left - CARD_WIDTH_PX - CARD_GAP_PX) };
      case 'right': {
        const cardLeft = clampLeft(rect.right + CARD_GAP_PX);
        // If the card fits below the target's top edge, top-align to the target
        if (rect.top + CARD_ESTIMATED_HEIGHT_PX + VIEWPORT_MARGIN_PX <= vh) {
          return { top: Math.max(VIEWPORT_MARGIN_PX, rect.top), left: cardLeft };
        }
        // Target is near the bottom — bottom-align the card to the target's bottom edge
        return { bottom: Math.max(VIEWPORT_MARGIN_PX, vh - rect.bottom), left: cardLeft };
      }
      case 'top': {
        const fitsAbove = rect.top - CARD_GAP_PX - CARD_ESTIMATED_HEIGHT_PX - VIEWPORT_MARGIN_PX >= 0;
        if (fitsAbove) {
          return {
            bottom: vh - rect.top + CARD_GAP_PX,
            left: clampLeft(rect.left + rect.width / 2 - CARD_WIDTH_PX / 2),
          };
        }
        // Not enough room above — flip to below
        return {
          top: rect.bottom + CARD_GAP_PX,
          left: clampLeft(rect.left + rect.width / 2 - CARD_WIDTH_PX / 2),
        };
      }
      case 'bottom': {
        const availableBelow = vh - rect.bottom - CARD_GAP_PX - VIEWPORT_MARGIN_PX;
        const fitsBelow = availableBelow >= CARD_ESTIMATED_HEIGHT_PX;

        if (fitsBelow) {
          const bodyMaxHeightPx = Math.max(80, availableBelow - CARD_CHROME_HEIGHT_PX);

          return {
            positionSx: {
              top: rect.bottom + CARD_GAP_PX,
              left: clampLeft(rect.left + rect.width / 2 - CARD_WIDTH_PX / 2),
            },
            bodySx: { maxHeight: `${bodyMaxHeightPx}px` },
          };
        }

        const availableAbove = rect.top - CARD_GAP_PX - VIEWPORT_MARGIN_PX;
        const bodyMaxHeightPx = Math.max(80, availableAbove - CARD_CHROME_HEIGHT_PX);

        return {
          positionSx: {
            bottom: vh - rect.top + CARD_GAP_PX,
            left: clampLeft(rect.left + rect.width / 2 - CARD_WIDTH_PX / 2),
          },
          bodySx: { maxHeight: `${bodyMaxHeightPx}px` },
        };
      }
      default:
        return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- placement is extracted above; eslint would require currentStep which is unstable */
  }, [targetInfo, viewport, currentStep?.placement]);

  // bottom returns a split { positionSx, bodySx } shape; all others return a flat sx object.
  const isBottomSplit = cardPositionSx !== null && 'positionSx' in cardPositionSx;

  return {
    targetInfo,
    cardPositionSx: (isBottomSplit
      ? (cardPositionSx as { positionSx: Record<string, unknown> }).positionSx
      : cardPositionSx),
    cardBodySx: (isBottomSplit
      ? (cardPositionSx as { bodySx: Record<string, unknown> | null }).bodySx ?? null
      : null),
  };
};
