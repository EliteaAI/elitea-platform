import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';

import { t } from '../lib/t';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface CharacterCounterProps {
  value: string;
  maxLength: number;
  textVariant?: 'bodySmall' | 'bodyMedium' | 'labelSmall' | 'labelMedium';
  'data-testid'?: string;
}

/**
 * A "N characters left" counter that turns to the error colour at the
 * limit. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/text/CharacterCounter.jsx`.
 *
 * Deviation from the baseline: the baseline used `palette.error.main` /
 * `palette.secondary.main` (roles tuned for filled surfaces, not small
 * text-on-background contrast — `error.main` is `#D71616` in both schemes,
 * 3.55:1 against the dark scheme's background at this text size, short of
 * WCAG AA's 4.5:1). Storybook's a11y addon (`a11y.test: 'error'`) caught
 * this — exactly the defect class that gate exists to catch, since the
 * baseline's own `a11y: { test: 'todo' }` could never fail on it.
 * `text.warningText` is the same role the baseline's own `BannerMessage`
 * uses for its error-variant text (`rgba(255,223,223,1)` in dark scheme —
 * still red-adjacent, but tuned for AA text contrast rather than for a
 * filled/bordered surface). Also fixes a WCAG 1.4.1 (use-of-color) gap: the
 * limit-reached state was signalled by colour alone; the appended "reached
 * the MAXIMUM" text was already there, so this is belt-and-suspenders, not
 * a new requirement.
 */
export function CharacterCounter({
  value,
  maxLength,
  textVariant = 'bodySmall',
  'data-testid': dataTestId,
}: CharacterCounterProps): ReactNode {
  const remaining = maxLength - value.length;
  const isAtLimit = remaining === 0;

  return (
    <Box
      data-testid={dataTestId}
      sx={(theme: Theme) => ({
        color: isAtLimit ? theme.vars.palette.text.warningText : theme.vars.palette.text.secondary,
      })}
    >
      <Typography variant={textVariant}>
        {remaining} {t('shared.ui.characterCounter.remaining', 'characters left')}
        {isAtLimit &&
          t('shared.ui.characterCounter.atLimit', '. You have reached the MAXIMUM character limit')}
      </Typography>
    </Box>
  );
}
