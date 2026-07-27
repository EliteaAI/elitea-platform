import { type ReactNode, useCallback, useState } from 'react';

import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';

import { AttentionIcon } from '../icons/attention-icon';
import { ErrorIcon } from '../icons/error-icon';
import { InfoIcon } from '../icons/info-icon';

/** @public */
export type BannerMessageVariant = 'warning' | 'error' | 'info';

const VARIANT_ICON = {
  warning: AttentionIcon,
  error: ErrorIcon,
  info: InfoIcon,
} as const;

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface BannerMessageProps {
  message: string;
  variant?: BannerMessageVariant;
}

const TIME_SHOW_TOOLTIP_MS = 1000;

function variantPalette(theme: Theme, variant: BannerMessageVariant) {
  const { palette } = theme.vars;
  if (variant === 'error') {
    return {
      iconColor: palette.background.button.danger,
      background: palette.background.errorBkg,
      border: palette.background.wrongBkg,
      text: palette.text.warningText,
    };
  }
  if (variant === 'info') {
    return {
      iconColor: palette.icon.fill.tips,
      background: palette.background.tips,
      border: palette.border.tips,
      text: palette.text.tips,
    };
  }
  return {
    iconColor: palette.icon.fill.attention,
    background: palette.background.attention,
    border: palette.border.attention,
    text: palette.text.attention,
  };
}

/**
 * A dismissable, expandable inline warning/error/info banner. Click or
 * `Enter`/`Space` toggles between the truncated (one-line) and expanded
 * reading. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/banner-message/BannerMessage.jsx`.
 *
 * R-C1 fix: the baseline used a clickable `Box` with only an `onClick`
 * handler — no keyboard affordance at all. This port is a real `<button>`
 * (`ButtonBase`, which is a native `<button>` under the hood), so `Enter`/
 * `Space` activation, focus and `tabIndex` all come from the browser instead
 * of a hand-rolled `role`/`onKeyDown` shim.
 */
export function BannerMessage({ message, variant = 'warning' }: BannerMessageProps): ReactNode {
  const [expanded, setExpanded] = useState(false);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <Tooltip
      title={expanded ? '' : message}
      placement="top"
      enterDelay={TIME_SHOW_TOOLTIP_MS}
    >
      <ButtonBase
        data-testid="credential-warning-banner"
        aria-expanded={expanded}
        aria-label={message}
        onClick={handleToggle}
        disableRipple
        sx={(theme: Theme) => {
          const colors = variantPalette(theme, variant);
          return {
            display: 'flex',
            alignItems: 'flex-start',
            gap: theme.spacing(1.5),
            padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
            backgroundColor: colors.background,
            border: `1px solid ${colors.border}`,
            borderRadius: theme.vars.shape.radiusMd,
            cursor: 'pointer',
            marginTop: theme.spacing(1),
            textAlign: 'left',
          };
        }}
      >
        <Box
          component={VARIANT_ICON[variant]}
          aria-hidden="true"
          sx={(theme: Theme) => ({
            flexShrink: 0,
            width: '1rem',
            height: '1rem',
            color: variantPalette(theme, variant).iconColor,
            fill: variantPalette(theme, variant).iconColor,
          })}
        />
        <Typography
          variant="labelSmall"
          sx={(theme: Theme) => ({
            flex: 1,
            color: variantPalette(theme, variant).text,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: expanded ? 'unset' : 1,
            wordBreak: 'break-word',
          })}
        >
          {message}
        </Typography>
      </ButtonBase>
    </Tooltip>
  );
}
