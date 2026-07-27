import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { combineSx } from '../lib/combineSx';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface GradientIconWrapperProps {
  children: ReactNode;
  /** Diameter (CSS length). Defaults to `'2.75rem'`. */
  size?: string;
  sx?: SxProps<Theme>;
}

/**
 * A circular gradient-bordered icon frame, used for entity avatars. Ported
 * from `apps/elitea-ui/src/[fsd]/shared/ui/icon/GradientIconWrapper.jsx`.
 */
export function GradientIconWrapper({ children, size = '2.75rem', sx }: GradientIconWrapperProps): ReactNode {
  return (
    <Box
      sx={combineSx(
        (theme: Theme) => ({
          flexShrink: 0,
          width: size,
          height: size,
          borderRadius: theme.vars.shape.radiusLg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          background: theme.vars.palette.background.icon.entityGradient,
          color: theme.vars.palette.text.primary,
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            // Same token as the parent's radius (R-T10 has no member-expression
            // form of the `inherit` keyword to fall back on).
            borderRadius: theme.vars.shape.radiusLg,
            padding: '0.0625rem',
            background: theme.vars.palette.background.icon.entityBorderGradient,
            // Mask gradients only use the alpha channel; `currentColor` (always
            // opaque here) avoids a raw colour literal for a value CSS never
            // actually paints (R-T1).
            WebkitMask: 'linear-gradient(currentColor 0 0) content-box, linear-gradient(currentColor 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            pointerEvents: 'none',
          },
        }),
        sx,
      )}
    >
      {children}
    </Box>
  );
}
