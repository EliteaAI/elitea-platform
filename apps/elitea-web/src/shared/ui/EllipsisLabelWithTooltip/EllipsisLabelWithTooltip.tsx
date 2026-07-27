import type { ReactNode } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip, { type TooltipProps } from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import type { EliteaTypographyVariant } from '@/shared/brand/typography';

import { combineSx } from '../lib/combineSx';
import { useTextOverflow } from '../lib/useTextOverflow';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface EllipsisLabelWithTooltipProps {
  label: string;
  placement?: TooltipProps['placement'];
  variant?: EliteaTypographyVariant;
  sx?: SxProps<Theme>;
}

/**
 * A single-line label that truncates with an ellipsis and shows the full
 * text in a tooltip, but only once it is actually truncated. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/label/EllipsisLabelWithTooltip.jsx`.
 *
 * Overflow detection is delegated to `shared/ui/lib/useTextOverflow` — S1
 * lifted that hook out of the baseline's
 * `[fsd]/shared/lib/hooks/useTextOverflow.hooks.js` specifically because
 * this component (plus three others) all duplicated it.
 *
 * Fix, not in the baseline: the baseline's own styles used `display:
 * 'inline'` alongside `overflow: hidden` / `text-overflow: ellipsis`. A
 * plain inline box has no width boundary of its own to overflow AGAINST —
 * `text-overflow: ellipsis` never fires on it (the baseline's version only
 * ever "worked" because every real call site happened to sit inside a flex
 * container, which CSS "blockifies" a flex item's `display` to `block`
 * regardless of the declared value — an accident of context, not something
 * this component can rely on). This unit's own Storybook `Truncated` story,
 * run for real in Playwright/Chromium (`a11y`/interaction tests execute
 * against actual layout, unlike the jsdom unit tests, which fake
 * `scrollWidth`/`clientWidth` directly), reproduced the gap: hovering an
 * overflowing label never opened a tooltip. `inline-block` + `maxWidth:
 * '100%'` keeps the element sitting inline with surrounding content while
 * giving it a real width boundary to truncate against, independent of
 * whatever container it's placed in.
 */
export function EllipsisLabelWithTooltip({
  label,
  placement = 'top',
  variant,
  sx,
}: EllipsisLabelWithTooltipProps): ReactNode {
  const { textRef, isOverflowing } = useTextOverflow(label);

  return (
    <Tooltip
      title={isOverflowing ? label : ''}
      placement={placement}
    >
      <Typography
        ref={textRef}
        component="span"
        variant={variant}
        noWrap
        sx={combineSx({ display: 'inline-block', maxWidth: '100%', verticalAlign: 'bottom' }, sx)}
      >
        {label}
      </Typography>
    </Tooltip>
  );
}
