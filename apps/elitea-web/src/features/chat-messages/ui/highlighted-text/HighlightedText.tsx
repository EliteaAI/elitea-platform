/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/highlighted-text/
 * HighlightedText.jsx` — renders text with highlighted ranges, used as the
 * `highlightOverlay` slot consumer by `features/chat-input/ui/UserInput.tsx`.
 *
 * The slot contract is defined in `UserInput.types.ts`:
 * `UserInputHighlightOverlaySlotProps = { text, ranges }` where
 * `HighlightRange = { start, end }`.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';

import type { HighlightRange } from '@/features/chat-input/ui/UserInput.types';

/** @public Props for `HighlightedText` — matches `UserInputHighlightOverlaySlotProps`. */
export interface HighlightedTextProps {
  /** The full text to render. */
  readonly text: string;
  /** A list of `[start, end)` character ranges to highlight. */
  readonly ranges: readonly HighlightRange[];
}

/**
 * `HighlightedText` — renders the text with highlighted ranges applied via
 * inline spans with the `highlighted` class name. Each range is extracted
 * and wrapped in a `<Box component="span" className="highlighted">`.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/highlighted-text/
 * HighlightedText.jsx`.
 */
export function HighlightedText({ text, ranges }: HighlightedTextProps): ReactNode {
  if (!ranges?.length || !text) {
    return <>{text}</>;
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const range of ranges) {
    const { start, end } = range;
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }
    if (start < text.length && end <= text.length) {
      parts.push(
        <Box
          key={`h-${start}`}
          component="span"
          sx={{
            backgroundColor: 'rgba(255, 255, 0, 0.25)',
            borderRadius: '2px',
            px: 0.25,
          }}
        >
          {text.slice(start, end)}
        </Box>,
      );
    }
    lastIndex = Math.max(lastIndex, end);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}
