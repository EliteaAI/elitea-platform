import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { GradientIconWrapper } from '@/shared/ui/GradientIconWrapper';
import { combineSx } from '@/shared/ui/lib/combineSx';
import { ApplicationsIcon } from '@/shared/ui/icons/applications-icon';
import { FlowIcon } from '@/shared/ui/icons/flow-icon';
import { HumanIcon } from '@/shared/ui/icons/human-icon';
import { ToolIcon } from '@/shared/ui/icons/tool-icon';

/**
 * Local duplicate of `features/agents/ui/EntityIcon.tsx` /
 * `features/toolkits/ui/EntityIcon.tsx` (`no-sideways-features` forbids
 * importing either), itself a scoped port of `apps/elitea-ui/src/components/
 * EntityIcon.jsx` for `NewParticipantCard.tsx`'s ONE call site, which always
 * passes `editable={false}`. Only the read-only path is ported — see the
 * sibling copies' own doc comments for the full `SelectIconDialog`
 * scope-reduction rationale, not re-litigated here.
 *
 * Adds a fourth `entityType`, `'user'`, that the two sibling copies don't
 * need (their single call sites never render a user participant) — this
 * one does, via the toolkit/user catalog-browse fallback in
 * `useRecommendations.ts`.
 */
export interface EntityIconProps {
  readonly icon?: { readonly component?: ReactNode | undefined; readonly url?: string | undefined } | undefined;
  readonly entityType: 'agent' | 'pipeline' | 'toolkit' | 'user';
  readonly sx?: SxProps<Theme> | undefined;
  readonly imageSx?: SxProps<Theme> | undefined;
}

const fallbackIconSx: SxProps<Theme> = (theme: Theme) => ({ color: theme.vars.palette.icon.fill.default, width: '1rem', height: '1rem' });

function EntityTypeFallbackIcon({ entityType }: { readonly entityType: EntityIconProps['entityType'] }): ReactNode {
  if (entityType === 'agent') {
    return (
      <Box
        component={ApplicationsIcon}
        sx={fallbackIconSx}
      />
    );
  }
  if (entityType === 'pipeline') {
    return (
      <Box
        component={FlowIcon}
        sx={fallbackIconSx}
      />
    );
  }
  if (entityType === 'user') {
    return (
      <Box
        component={HumanIcon}
        sx={fallbackIconSx}
      />
    );
  }
  return (
    <Box
      component={ToolIcon}
      sx={fallbackIconSx}
    />
  );
}

const frameSx: SxProps<Theme> = (theme: Theme) => ({
  width: '2.25rem',
  height: '2.25rem',
  minWidth: '2.25rem',
  borderRadius: theme.vars.shape.radiusPill,
});

const centeredSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'center' };

export function EntityIcon({ icon, entityType, sx, imageSx }: EntityIconProps): ReactNode {
  if (icon?.url && !icon.component) {
    return (
      <Box
        component="img"
        data-testid="entity-icon"
        src={icon.url}
        alt={t('chatRecommendations.entityIcon.previewAlt', 'Preview')}
        sx={combineSx(frameSx, sx, imageSx)}
      />
    );
  }

  return (
    <GradientIconWrapper
      size="2.25rem"
      sx={combineSx(frameSx, sx)}
    >
      <Box
        data-testid="entity-icon"
        sx={centeredSx}
      >
        {icon?.component ?? <EntityTypeFallbackIcon entityType={entityType} />}
      </Box>
    </GradientIconWrapper>
  );
}
