/**
 * Gradient helpers for resource cards — local reimplementation.
 *
 * The old app deep-imports `getCardGradientBorderBefore` /
 * `getCardGradientStyles` from `@/utils/cardStyles` (Unit A6 `features/apps`).
 * Those are NOT exported at the public surface and are coupled to the old
 * Redux/RTK Query store pattern. Per Key Decision #1 (issue #26) we
 * re-implement the gradient logic here as a pure style helper.
 *
 * TODO (Unit A6 consolidation): when `features/apps` exports a stable
 * public card-gradient surface, move this file there and import it back
 * from `shared/` to avoid duplication.
 */
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * Returns the `::before` pseudo-element styles that create the gradient
 * border overlay via the CSS mask-composite technique.
 *
 * Same approach as the old `getCardGradientBorderBefore` (Unit A6
 * `utils/cardStyles.js`).
 */
export function getCardGradientBorderBefore(palette: Theme['vars']['palette']): Record<string, string> {
  const borderColor = (palette.border?.cardsOutlinesGradient) ?? 'transparent';
  return {
    content: '""',
    position: 'absolute',
    inset: '0',
    borderRadius: 'inherit',
    padding: '0.0625rem',
    background: borderColor,
    // `mask` and `maskComposite` are non-standard CSS properties that need
    // explicit string keys to satisfy the `Record` type.
    mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    maskComposite: 'exclude',
    WebkitMaskComposite: 'xor',
    pointerEvents: 'none',
  };
}

/**
 * Returns the base sx callback shared across gradient cards.
 *
 * @param enableHover — set `false` for a disabled card variant.
 */
export function getCardGradientStyles(
  palette: Theme['vars']['palette'],
  options?: { enableHover?: boolean },
): SxProps<Theme> {
  const { enableHover = true } = options ?? {};
  const borderBefore = getCardGradientBorderBefore(palette);
  const bg = palette.background;

  const base: SxProps<Theme> = {
    position: 'relative',
    borderRadius: '0.75rem',
    border: 'none',
    background: bg?.card?.gradientDark ?? 'transparent',
    '&::before': borderBefore,
  };

  if (enableHover) {
    return [
      base,
      {
        '&:hover': {
          background: bg?.card?.hover ?? 'transparent',
          '&::before': {
            background: bg?.card?.hoverBorderGradient ?? 'transparent',
          },
          boxShadow: bg?.card?.hoverShadow ?? 'none',
        },
      },
    ] as SxProps<Theme>;
  }

  return base;
}
