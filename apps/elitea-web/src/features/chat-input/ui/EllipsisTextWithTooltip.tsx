import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { combineSx } from '@/shared/ui/lib/combineSx';

export interface EllipsisTextWithTooltipProps {
  readonly text: string;
  readonly onClick: () => void;
  readonly sx?: SxProps<Theme> | undefined;
  readonly textSx?: SxProps<Theme> | undefined;
}

const ellipsisTextSx: SxProps<Theme> = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: '2',
  WebkitBoxOrient: 'vertical',
};

// Baseline: `borderRadius: '0.75rem'` (12px) ad hoc. R-T10 forbids ad-hoc
// radii — `theme.vars.shape.radiusLg` (16px, `shared/brand/tokens/default.pack.json`)
// is the closest token to the baseline's intent (a distinctly rounded,
// pill-like clickable card), used here instead.
const starterItemSx: SxProps<Theme> = (theme) => ({
  width: '100%',
  boxSizing: 'border-box',
  cursor: 'pointer',
  padding: '0.5rem 1rem',
  borderRadius: theme.vars.shape.radiusLg,
  background: theme.vars.palette.background.conversationStarters.default,
  '&:hover': {
    background: theme.vars.palette.background.conversationStarters.hover,
  },
});

const tooltipSlotProps = { tooltip: { sx: { maxWidth: '31.25rem' } } };

/**
 * Ported from `shared/ui/lib/useTextOverflow.ts` (S1's own port of
 * `apps/elitea-ui/src/[fsd]/shared/lib/hooks/useTextOverflow.hooks.js`),
 * widened to check BOTH `clientHeight < scrollHeight` (the 2-line
 * `-webkit-line-clamp` truncating vertically) and `clientWidth <
 * scrollWidth` (the original, width-only check) — the same two-dimension
 * check the baseline's own `handleMouseEnter` used (`ConversationStarters.jsx:
 * 234-236`), just re-homed onto a mount-time + `ResizeObserver` trigger
 * instead of a mouse-enter trigger. See `EllipsisTextWithTooltip`'s own doc
 * comment below for why the mouse-enter trigger had to go.
 *
 * Deliberately duplicated instead of widening `shared/ui/lib/useTextOverflow`
 * itself: that hook has 4 existing consumers (`EllipsisLabelWithTooltip`,
 * `ConditionalTooltip`, `TypographyWithConditionalTooltip`, `EllipsisTypography`),
 * all single-line/width-only; adding a height check there would be an
 * unreviewed behavior change to code this unit does not own, for a need
 * only this 2-line-clamped component has.
 */
function useClampOverflow(text: string): { readonly textRef: RefObject<HTMLDivElement | null>; readonly isOverflowing: boolean } {
  const textRef = useRef<HTMLDivElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;

    const checkOverflow = (): void => {
      const current = textRef.current;
      if (!current) return;
      setIsOverflowing(current.clientHeight < current.scrollHeight || current.clientWidth < current.scrollWidth);
    };

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

/**
 * Ported from `apps/elitea-ui/src/components/ConversationStarters.jsx`'s
 * second named export, `EllipsisTextWithTooltip` (the file's default export,
 * the agent-editor `ConversationStarters` form field, already landed in
 * `features/agents`; its third export, `ConversationStartersView`, is
 * confirmed dead code — zero call sites in the baseline — and is not
 * ported).
 *
 * A clickable "starter" card: text clamped to 2 lines, with the full text
 * shown in a tooltip only once it is actually clamped/truncated.
 *
 * BUG FIX, disclosed — the overflow-detection TRIGGER, not just the
 * tooltip-mounting mechanics, had to change from the baseline's approach.
 * The baseline recomputes `isTooltipVisible` from inside `onMouseEnter`
 * itself, then conditionally renders `<Tooltip>` only once that flips true.
 * Ported 1:1 first (both the mouse-enter trigger AND the conditional
 * mount), it reproducibly never opened in this file's own tests: MUI's
 * `Tooltip` decides whether to open by reading `disableHoverListener`
 * (or, for the conditional-mount version, simply whether it exists yet)
 * SYNCHRONOUSLY, at the moment it receives its OWN hover event — and that
 * event fires from the exact same underlying native `mouseover` this
 * component's ancestor `onMouseEnter` also fires from, one React commit
 * BEFORE the state update the overflow check just produced is visible to
 * it. Flipping `disableHoverListener`/mounting the tooltip a render later
 * does not retroactively arm a hover event that already happened — the
 * user would have to leave and re-enter before it ever opened, in a real
 * browser as much as in this file's own tests (confirmed empirically,
 * not just in theory).
 *
 * `shared/ui/ConditionalTooltip` / `TypographyWithConditionalTooltip` (S1)
 * avoid exactly this trap because their own overflow flag settles on
 * MOUNT (via `useTextOverflow`'s timeouts/`ResizeObserver`), independent of
 * any hover — so by the time a real hover event arrives, `disableHoverListener`
 * is already correct. `useClampOverflow` above adopts that same
 * mount-time/`ResizeObserver` shape (not a mouse-enter callback) for
 * exactly this reason, widened to also catch the 2-line clamp's vertical
 * overflow. Net effect: identical visual/UX contract to the baseline (no
 * tooltip until the 2-line clamp actually truncates), actually functional.
 *
 * Colour/typography are left off the local tooltip `sx` for the same
 * reason `ConditionalTooltip`'s own doc comment gives —
 * `shared/brand/mui-overrides/MuiTooltip.ts` already covers it globally,
 * only the per-usage `maxWidth` stays local.
 *
 * `onClick` drops the baseline's implicit `MouseEvent` passthrough — the
 * only real caller (`ChatConversationStarters`, this slice) only ever needs
 * a zero-arg "this was clicked" signal (baseline: `handleClick = starter =>
 * () => onSend(starter)`, itself already zero-arg).
 */
export function EllipsisTextWithTooltip({ text, onClick, sx, textSx }: EllipsisTextWithTooltipProps): ReactNode {
  const { textRef, isOverflowing } = useClampOverflow(text);

  return (
    <Box
      sx={combineSx(starterItemSx, sx)}
      onClick={onClick}
    >
      <Tooltip
        placement="top"
        title={text}
        disableHoverListener={!isOverflowing}
        slotProps={tooltipSlotProps}
      >
        <Typography
          ref={textRef}
          component="div"
          variant="bodyMedium"
          color="text.secondary"
          sx={combineSx(ellipsisTextSx, textSx)}
        >
          {text}
        </Typography>
      </Tooltip>
    </Box>
  );
}
