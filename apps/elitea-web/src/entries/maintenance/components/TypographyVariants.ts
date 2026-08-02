/**
 * Typography variants shared between the main app and the maintenance entry.
 *
 * Copied from MUI's `MainTheme.js` so the maintenance splash renders with
 * identical heading/body sizing without importing the full theme (circular
 * dependency risk). Only the variants used by the maintenance components are
 * included here.
 */
import type { Theme } from '@mui/material/styles';

export const typographyVariants = {
  headingLarge: {
    color: (theme: Theme) => theme.palette.text.secondary,
    fontStyle: 'semibold',
    fontWeight: 600,
    fontSize: '1.25rem',
    lineHeight: '2rem',
  },
  headingMedium: {
    color: (theme: Theme) => theme.palette.text.secondary,
    fontStyle: 'normal',
    fontWeight: 600,
    fontSize: '16px',
    lineHeight: '24px',
  },
  headingSmall: {
    color: (theme: Theme) => theme.palette.text.secondary,
    fontStyle: 'normal',
    fontWeight: 600,
    fontSize: '14px',
    lineHeight: '24px',
  },
  bodyMedium: {
    fontStyle: 'normal',
    fontWeight: 400,
    fontSize: '14px',
    lineHeight: '24px',
  },
} as const;
