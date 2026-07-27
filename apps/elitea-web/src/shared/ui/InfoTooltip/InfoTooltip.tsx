import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import type { TooltipProps } from '@mui/material/Tooltip';
import Tooltip from '@mui/material/Tooltip';

import { InfoIcon } from '../icons/info-icon';
import { combineSx } from '../lib/combineSx';
import { t } from '../lib/t';
import { TooltipMarkdownContent } from '../TooltipMarkdownContent';

/** @public */
export interface InfoTooltipIconSize {
  width?: number;
  height?: number;
}

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface InfoTooltipProps {
  /** Tooltip content. A plain string renders through `TooltipMarkdownContent`; any other `ReactNode` renders as-is. */
  title: ReactNode;
  placement?: TooltipProps['placement'];
  size?: InfoTooltipIconSize;
  /** When set, the icon is also a link (opens in a new tab). */
  href?: string;
  disableTooltip?: boolean;
  sx?: SxProps<Theme>;
  'data-testid'?: string;
}

const DEFAULT_ICON_SIZE = { width: 16, height: 16 };

/**
 * An info (`i`) glyph that shows `title` in a tooltip on hover or focus,
 * optionally also acting as a link. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/tooltip/InfoTooltip.jsx`.
 *
 * Deviations from the baseline:
 *  - The baseline's `infoTooltip` prop was a polymorphic string-or-
 *    `ReactElement`-or-config-object (`{title, placement, zIndex, icon}`)
 *    parsed at runtime by a 30-line `parseInfoTooltip`, PLUS a separate
 *    `TitleComponent`/`titleComponentProps` pair for injecting an
 *    arbitrary rich-content component — three different ways to say
 *    "render this as the tooltip's content" for one concern. This port
 *    flattens that to the ordinary shared/ui shape: `title` (string or
 *    node) plus flat `placement`/`size` props — a caller that wants a
 *    rich component today just passes `title={<MyComponent {...props} />}`
 *    directly (already one of the baseline's own accepted `infoTooltip`
 *    shapes), so nothing is lost, only the redundant second path.
 *  - R-C1 fix: the baseline's icon was `aria-hidden` inside a plain,
 *    unlabelled, non-focusable `Box` — a mouse-only affordance invisible
 *    to keyboard/screen-reader users (MUI's `Tooltip` shows on focus too,
 *    but only if the child can RECEIVE focus). This port gives the wrapper
 *    a real accessible name (`aria-label`) and native keyboard focus: a
 *    real `<button>` when there is no `href` (not `role="button"` on a
 *    `<span>` — `jsx-a11y/prefer-tag-over-role` exists precisely because a
 *    real element gets focus/activation/`disabled` semantics for free), or
 *    the already-focusable `<a>` when there is.
 */
export function InfoTooltip({
  title,
  placement = 'top',
  size,
  href,
  disableTooltip = false,
  sx,
  'data-testid': dataTestId,
}: InfoTooltipProps): ReactNode {
  const width = size?.width ?? DEFAULT_ICON_SIZE.width;
  const height = size?.height ?? DEFAULT_ICON_SIZE.height;
  const accessibleName =
    typeof title === 'string' ? title : t('shared.ui.infoTooltip.moreInformation', 'More information');

  const iconSx = combineSx(
    {
      display: 'flex',
      alignItems: 'center',
      height: '100%',
      cursor: 'pointer',
      '&:hover': { opacity: 0.8 },
    },
    sx,
  );
  const icon = (
    <Box
      component={InfoIcon}
      aria-hidden="true"
      sx={{ width, height }}
    />
  );

  const iconElement = href ? (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={accessibleName}
      data-testid={dataTestId}
      sx={iconSx}
    >
      {icon}
    </Box>
  ) : (
    <Box
      component="button"
      type="button"
      aria-label={accessibleName}
      data-testid={dataTestId}
      sx={combineSx(
        { border: 'none', background: 'none', padding: 0, font: 'inherit' },
        iconSx,
      )}
    >
      {icon}
    </Box>
  );

  if (disableTooltip) return iconElement;

  return (
    <Tooltip
      title={typeof title === 'string' ? <TooltipMarkdownContent>{title}</TooltipMarkdownContent> : title}
      placement={placement}
    >
      {iconElement}
    </Tooltip>
  );
}
