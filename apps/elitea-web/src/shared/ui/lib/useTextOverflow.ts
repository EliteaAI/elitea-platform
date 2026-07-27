import { useEffect, useRef, useState } from 'react';

/**
 * Detects whether the text rendered inside the returned `textRef` element is
 * truncated (its content overflows the element's box). Ported verbatim from
 * `apps/elitea-ui/src/[fsd]/shared/lib/hooks/useTextOverflow.hooks.js` —
 * shared across four components (`EllipsisLabelWithTooltip`,
 * `ConditionalTooltip`, `TypographyWithConditionalTooltip`, and
 * `EllipsisTypography`), so it is lifted into `shared/ui/lib` instead of
 * being duplicated four times.
 */
export function useTextOverflow(text: unknown): {
  textRef: React.RefObject<HTMLElement | null>;
  isOverflowing: boolean;
} {
  const textRef = useRef<HTMLElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;

    const checkOverflow = (): void => {
      const current = textRef.current;
      if (!current) return;
      setIsOverflowing(current.scrollWidth > current.clientWidth);
    };

    // Multiple delays cover different rendering/layout-settle scenarios,
    // matching the baseline's behaviour exactly.
    const timeouts = [50, 200].map((delay) => setTimeout(checkOverflow, delay));

    const resizeObserver = new ResizeObserver(() => {
      setTimeout(checkOverflow, 10);
    });
    resizeObserver.observe(element);

    return () => {
      timeouts.forEach((id) => clearTimeout(id));
      resizeObserver.disconnect();
    };
  }, [text]);

  return { textRef, isOverflowing };
}
