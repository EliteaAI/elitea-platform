import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface NoResultsMessageProps {
  title: ReactNode;
  description: ReactNode;
}

/**
 * Centered "no results" placeholder, designed for `GroupedCategory`'s
 * `renderNoResults` slot. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/category/NoResultsMessage.jsx`.
 */
export function NoResultsMessage({ title, description }: NoResultsMessageProps): ReactNode {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '12.5rem',
        gap: theme.spacing(2),
      })}
    >
      <Typography
        variant="headingMedium"
        sx={(theme) => ({ color: theme.vars.palette.text.secondary })}
      >
        {title}
      </Typography>
      <Typography
        variant="bodyMedium"
        sx={(theme) => ({ color: theme.vars.palette.text.disabled, textAlign: 'center', maxWidth: '25rem' })}
      >
        {description}
      </Typography>
    </Box>
  );
}
