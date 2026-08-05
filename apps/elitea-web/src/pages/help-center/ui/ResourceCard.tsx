/**
 * ResourceCard — gradient-bordered card for the Help Center.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/resources/ui/ResourceCard.jsx`.
 *
 * The old app composes `getCardGradientStyles(palette, { enableHover: false
 * })` (from `@/utils/cardStyles`, Unit A6) with a per-`colorScheme`
 * `background.resourceCard.<scheme>.{card,borderGradient}` token override
 * (`resourceCardStyles.card` in the baseline). `cardSx` below inlines that
 * same composition directly against `theme.vars.palette.background.
 * resourceCard[scheme]` rather than calling into `./cardGradient.ts` (a
 * separate local reimplementation kept for possible future reuse but not a
 * type-safe fit here — see the NOTE below) — both the scheme-specific
 * background/border-gradient AND `enableHover: false` (cards are static,
 * non-interactive) are preserved from the baseline.
 *
 * NOTE: sx values are defined inline to avoid TS2769 "No overload matches"
 * errors that occur when passing object property lookups (SxProps<Theme> |
 * undefined) through MUI's strict sx prop typing.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { GradientIconWrapper } from '@/shared/ui/GradientIconWrapper';

import type { ResourceCardProps } from '../lib/ResourceCard.types';

const COLOR_SCHEMES = ['blue', 'orange', 'purple', 'green', 'pink'] as const;
type ColorScheme = (typeof COLOR_SCHEMES)[number];

/**
 * A gradient-bordered card displaying a title, description, icon, and
 * children (typically links or a "no links" message).
 */
export function ResourceCard({ title, description, icon, colorScheme, tourTargetId, children }: ResourceCardProps): ReactNode {
  return (
    <Box
      sx={cardSx(colorScheme as ColorScheme)}
      data-tour={tourTargetId}
    >
      <Box sx={cardHeaderSx}>
        <GradientIconWrapper sx={iconWrapperSx(colorScheme as ColorScheme)}>{icon}</GradientIconWrapper>
        <Box sx={headerTextSx}>
          <Typography
            variant="subtitle"
            color="text.secondary"
          >
            {title}
          </Typography>
          <Typography
            variant="bodySmall"
            color="text.primary"
          >
            {description}
          </Typography>
        </Box>
      </Box>
      <Divider sx={dividerSx(colorScheme as ColorScheme)} />
      <Box sx={bodySx}>{children}</Box>
    </Box>
  );
}

ResourceCard.displayName = 'ResourceCard';

/**
 * Card container styles — background and `::before` border-gradient are
 * resolved from the per-`scheme` `background.resourceCard.<scheme>` tokens
 * (falling back to the generic card-gradient tokens only if a scheme entry
 * were ever missing), matching the baseline's `resourceCardStyles.card`.
 *
 * Deliberately has NO `&:hover` rule: the baseline calls
 * `getCardGradientStyles(palette, { enableHover: false })` for these cards
 * (they are static informational panels, not clickable), so a hover state
 * here would make a non-interactive card look interactive.
 *
 * Exported (alongside the default component) so its per-scheme resolution
 * and hover-free shape can be regression-tested directly, the same way
 * `features/apps/lib/cardGradient.ts`'s `cardGradientSx` is tested. For the
 * same reason as that helper, this is deliberately NOT annotated
 * `: SxProps<Theme>` — that's a union type (including an array branch and a
 * bare-function branch), and both a JSX `sx={...}` consumer's overload
 * resolution AND a test file's field access (`cardSx('blue').background`)
 * need the concrete object-literal type TypeScript infers here, not the
 * widened union.
 */
export function cardSx(scheme: ColorScheme) {
  return {
    position: 'relative',
    borderRadius: '0.75rem',
    border: 'none',
    background: (t: Theme) =>
      t.vars.palette.background.resourceCard[scheme].card ?? t.vars.palette.background?.card?.gradientDark ?? 'transparent',
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: '0',
      borderRadius: 'inherit', /* oxlint-disable elitea/ad-hoc-radius -- 'inherit' is CSS keyword, not ad-hoc */
      padding: '0.0625rem',
      background: (t: Theme) =>
        t.vars.palette.background.resourceCard[scheme].borderGradient ?? t.vars.palette.border?.cardsOutlinesGradient ?? 'transparent',
      mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)', /* oxlint-disable elitea/no-raw-color -- #fff is transparent mask color */
      maskComposite: 'exclude',
      WebkitMaskComposite: 'xor',
      pointerEvents: 'none',
    },
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    minWidth: '23.75rem',
    maxWidth: '31.25rem',
    minHeight: '14.25rem',
  };
}

const cardHeaderSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: '1rem',
  px: '1rem',
  py: '0.75rem',
};

const headerTextSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  flex: 1,
};

function iconWrapperSx(scheme: ColorScheme): SxProps<Theme> {
  switch (scheme) {
    case 'blue':
      return {
        background: (t: Theme) => t.vars.palette.background.resourceCard.blue.icon ?? 'transparent',
        color: (t: Theme) => t.vars.palette.background.resourceCard.blue.iconColor ?? 'currentColor',
        '&::before': { background: (t: Theme) => t.vars.palette.background.resourceCard.blue.iconBorderGradient ?? 'transparent' },
      };
    case 'orange':
      return {
        background: (t: Theme) => t.vars.palette.background.resourceCard.orange.icon ?? 'transparent',
        color: (t: Theme) => t.vars.palette.background.resourceCard.orange.iconColor ?? 'currentColor',
        '&::before': { background: (t: Theme) => t.vars.palette.background.resourceCard.orange.iconBorderGradient ?? 'transparent' },
      };
    case 'purple':
      return {
        background: (t: Theme) => t.vars.palette.background.resourceCard.purple.icon ?? 'transparent',
        color: (t: Theme) => t.vars.palette.background.resourceCard.purple.iconColor ?? 'currentColor',
        '&::before': { background: (t: Theme) => t.vars.palette.background.resourceCard.purple.iconBorderGradient ?? 'transparent' },
      };
    case 'green':
      return {
        background: (t: Theme) => t.vars.palette.background.resourceCard.green.icon ?? 'transparent',
        color: (t: Theme) => t.vars.palette.background.resourceCard.green.iconColor ?? 'currentColor',
        '&::before': { background: (t: Theme) => t.vars.palette.background.resourceCard.green.iconBorderGradient ?? 'transparent' },
      };
    default:
      return {
        background: (t: Theme) => t.vars.palette.background.resourceCard.pink.icon ?? 'transparent',
        color: (t: Theme) => t.vars.palette.background.resourceCard.pink.iconColor ?? 'currentColor',
        '&::before': { background: (t: Theme) => t.vars.palette.background.resourceCard.pink.iconBorderGradient ?? 'transparent' },
      };
  }
}

function dividerSx(scheme: ColorScheme): SxProps<Theme> {
  switch (scheme) {
    case 'blue':
      return { borderColor: (t: Theme) => t.vars.palette.background.resourceCard.blue.divider ?? t.vars.palette.border?.lines ?? t.palette.divider };
    case 'orange':
      return { borderColor: (t: Theme) => t.vars.palette.background.resourceCard.orange.divider ?? t.vars.palette.border?.lines ?? t.palette.divider };
    case 'purple':
      return { borderColor: (t: Theme) => t.vars.palette.background.resourceCard.purple.divider ?? t.vars.palette.border?.lines ?? t.palette.divider };
    case 'green':
      return { borderColor: (t: Theme) => t.vars.palette.background.resourceCard.green.divider ?? t.vars.palette.border?.lines ?? t.palette.divider };
    default:
      return { borderColor: (t: Theme) => t.vars.palette.background.resourceCard.pink.divider ?? t.vars.palette.border?.lines ?? t.palette.divider };
  }
}

const bodySx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: (t: Theme) => t.spacing(1),
  px: '1.5rem',
  py: '0.75rem',
  flex: 1,
};
