import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { keyframes } from '@mui/material/styles';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface AnimatedLoadingTextProps {
  text: string;
}

const waveAnimation = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
`;

/** A plain space inside an `inline-block` span can be collapsed by
 * whitespace normalisation; a non-breaking space keeps every character
 * (including runs of spaces) visible and independently animated. */
const NON_BREAKING_SPACE = '\u00A0';

/**
 * Per-character wave-opacity loading text (e.g. "Thinking…"). Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/text/AnimatedLoadingText.jsx`.
 */
export function AnimatedLoadingText({ text }: AnimatedLoadingTextProps): ReactNode {
  return (
    <Typography
      variant="bodyMedium"
      color="text.secondary"
    >
      {text.split('').map((char, index) => (
        <Box
          // eslint-disable-next-line react/no-array-index-key -- characters have no stable identity
          key={index}
          component="span"
          sx={{
            display: 'inline-block',
            animation: `${waveAnimation} 2s ease-in-out infinite`,
            animationDelay: `${index * 0.1}s`,
            minWidth: char === ' ' ? '0.25em' : 'auto',
          }}
        >
          {char === ' ' ? NON_BREAKING_SPACE : char}
        </Box>
      ))}
    </Typography>
  );
}
