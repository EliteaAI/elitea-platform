import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import type { EliteaTypographyVariant } from '@/shared/brand/typography';

import { combineSx } from '../lib/combineSx';
import { InfoIcon } from '../icons/info-icon';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface InfoLabelWithTooltipProps {
  label: ReactNode;
  /** Renders an info icon after the label; hovering/focusing it shows this content. */
  tooltip?: ReactNode;
  /** Appends a trailing `*` to a string `label` (no-op for a node `label`). */
  required?: boolean;
  /** Typography variant for a string `label`. Ignored when `label` is a node. */
  variant?: EliteaTypographyVariant;
  /**
   * Renders `label` as an inline `span` that inherits the surrounding
   * text's colour/size instead of its own `Typography`. Needed when this
   * component is nested inside another `Typography` (e.g. a form field's
   * `label` slot) — mirrors the baseline's `inheritLabel`/`inheritColor`
   * combination, collapsed into one flag since every baseline call site
   * that set one set both.
   */
  inline?: boolean;
  iconSize?: number;
  sx?: SxProps<Theme>;
}

/**
 * A text label with an optional trailing info-icon tooltip and optional
 * required-asterisk. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/label/InfoLabelWithTooltip.jsx`.
 *
 * Deviation from the baseline: the baseline's `InfoTooltip` sub-component
 * (`href`/`linkTarget`/`TitleComponent`/markdown-rendered title, `disableTooltip`,
 * per-instance `slotProps`) is collapsed here into a plain `Tooltip` around a
 * `Box`-wrapped `InfoIcon` — `shared/ui` has no markdown renderer of its own
 * and no caller in this pass needs the link/markdown paths; `tooltip` takes
 * any `ReactNode`, so a caller that needs richer content still can pass one.
 */
export function InfoLabelWithTooltip({
  label,
  tooltip,
  required = false,
  variant = 'bodySmall',
  inline = false,
  iconSize = 16,
  sx,
}: InfoLabelWithTooltipProps): ReactNode {
  const content = required && typeof label === 'string' ? `${label} *` : label;

  const labelNode = inline ? (
    <Box
      component="span"
      sx={{ color: 'inherit' }}
    >
      {content}
    </Box>
  ) : (
    <Typography
      variant={variant}
      sx={(theme: Theme) => ({ color: theme.vars.palette.text.primary })}
    >
      {content}
    </Typography>
  );

  return (
    <Box
      sx={combineSx(
        (theme: Theme) => ({
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing(0.5),
        }),
        sx,
      )}
    >
      {labelNode}
      {tooltip !== undefined && (
        <Tooltip
          title={tooltip}
          placement="top"
        >
          <Box
            component={InfoIcon}
            aria-hidden="true"
            sx={(theme: Theme) => ({
              flexShrink: 0,
              width: iconSize,
              height: iconSize,
              color: theme.vars.palette.icon.fill.default,
            })}
          />
        </Tooltip>
      )}
    </Box>
  );
}
