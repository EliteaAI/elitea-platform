import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';

/**
 * A toolkit-domain-scoped local copy of
 * `apps/elitea-ui/src/[fsd]/entities/empty-state-page/ui/EmptyStatePage.jsx`
 * — the "zero toolkits at all yet, here's a Create CTA" state `ToolkitsList`
 * renders (baseline: `CardList`'s `customEmptyState` prop). NOT one of this
 * sub-unit's owned files (`entities/empty-state-page` has no port anywhere
 * in this app — not promoted, no other domain has built it either), same
 * "no shared home, build a small local copy" precedent
 * `features/agents/ui/AuthorsButton.tsx`'s own doc comment already
 * documents for an identically-situated baseline dependency.
 *
 * DISCLOSED CUT: no illustration image. The baseline renders a dark/light
 * PNG pair (`assets/images/Applications_{Dark,Light}_1.png`) — S2 only
 * ported the app's SVG icon set, not its PNG illustrations, and none of
 * that pair exists anywhere in this app yet. Text + CTA button only.
 */
export interface ToolkitsEmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly onCreateClick: () => void;
  readonly onGuidedTourClick?: () => void;
}

export function ToolkitsEmptyState({ title, description, onCreateClick, onGuidedTourClick }: ToolkitsEmptyStateProps): ReactNode {
  return (
    <Box sx={containerSx}>
      <Typography
        variant="headingSmall"
        sx={titleSx}
      >
        {title}
      </Typography>
      <Typography
        variant="bodyMedium"
        sx={descriptionSx}
      >
        {description}
      </Typography>
      <Box sx={actionsSx}>
        <BaseBtn
          variant="special"
          onClick={onCreateClick}
        >
          {t('features.toolkits.emptyState.create', 'Create')}
        </BaseBtn>
        {onGuidedTourClick && (
          <BaseBtn
            variant="secondary"
            onClick={onGuidedTourClick}
          >
            {t('features.toolkits.emptyState.guidedTour', 'Start Guided Tour')}
          </BaseBtn>
        )}
      </Box>
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: theme.spacing(2),
  paddingTop: theme.spacing(6),
  paddingBottom: theme.spacing(6),
  paddingLeft: theme.spacing(3),
  paddingRight: theme.spacing(3),
  textAlign: 'center',
});

const titleSx: SxProps<Theme> = (theme: Theme) => ({
  color: theme.vars.palette.text.secondary,
});

const descriptionSx: SxProps<Theme> = (theme: Theme) => ({
  color: theme.vars.palette.background.tooltip.default,
  maxWidth: '24rem',
});

const actionsSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  marginTop: theme.spacing(1),
});
