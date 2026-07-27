import type { ReactNode } from 'react';

import type { SxProps, Theme } from '@mui/material/styles';
import type { TooltipProps } from '@mui/material/Tooltip';
import Tooltip from '@mui/material/Tooltip';
import type { TypographyProps } from '@mui/material/Typography';
import Typography from '@mui/material/Typography';

import { combineSx } from '../lib/combineSx';
import { useTextOverflow } from '../lib/useTextOverflow';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface TypographyWithConditionalTooltipProps {
  children: ReactNode;
  /** Tooltip content, shown ONLY when `children` is actually truncated. */
  title: ReactNode;
  placement?: TooltipProps['placement'];
  variant?: TypographyProps['variant'];
  color?: TypographyProps['color'];
  sx?: SxProps<Theme>;
  'data-testid'?: string;
}

/**
 * Single-line, ellipsis-truncated `Typography` that shows `title` in a
 * tooltip only when the rendered text is actually truncated. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/tooltip/
 * TypographyWithConditionalTooltip.jsx`.
 *
 * Deviations from the baseline:
 *  - No `forwardRef` — no `shared/ui` component in this codebase forwards a
 *    ref yet (none has a caller that needs external DOM access to it); add
 *    it back if one does.
 *  - No `component` override — MUI 9.2's polymorphic `component` prop
 *    dispatches via overload resolution on the prop's LITERAL value; typed
 *    as a plain pass-through variable (as the baseline's untyped
 *    `...typographyProps` spread effectively did) it cannot select a
 *    concrete overload — `Typography`'s own default host element (a
 *    `<span>` for a variant with no `variantMapping`, matching this
 *    component's single-line inline use) covers every current need.
 *  - Colour/typography dropped from the local tooltip `sx` for the same
 *    reason as `ConditionalTooltip` — `shared/brand/mui-overrides/
 *    MuiTooltip.ts` already covers it globally.
 */
export function TypographyWithConditionalTooltip({
  children,
  title,
  placement = 'right',
  variant,
  color,
  sx,
  'data-testid': dataTestId,
}: TypographyWithConditionalTooltipProps): ReactNode {
  const { textRef, isOverflowing } = useTextOverflow(title);

  return (
    <Tooltip
      arrow
      title={isOverflowing ? title : ''}
      placement={placement}
      enterNextDelay={100}
      disableHoverListener={!isOverflowing}
      slotProps={{
        tooltip: { sx: { padding: '0.25rem 0.5rem', maxWidth: '18.75rem', wordWrap: 'break-word' } },
        popper: {
          sx: (theme: Theme) => ({ zIndex: theme.vars.zIndex.tooltip }),
          modifiers: [{ name: 'offset', options: { offset: [0, 8] } }],
        },
      }}
    >
      <Typography
        ref={textRef}
        variant={variant}
        color={color}
        data-testid={dataTestId}
        sx={combineSx({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, sx)}
      >
        {children}
      </Typography>
    </Tooltip>
  );
}
