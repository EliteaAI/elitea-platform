import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { GradientIconWrapper } from '@/shared/ui/GradientIconWrapper';
import { combineSx } from '@/shared/ui/lib/combineSx';
import { ApplicationsIcon } from '@/shared/ui/icons/applications-icon';
import { FlowIcon } from '@/shared/ui/icons/flow-icon';
import { ToolIcon } from '@/shared/ui/icons/tool-icon';

/**
 * Scoped local port of `apps/elitea-ui/src/components/EntityIcon.jsx`
 * (`EntityIcon` + its co-located `EntityTypeIcon`), for `ToolCard.jsx`'s
 * ONE call site (`ToolCard.jsx:437-444`), which always passes
 * `editable={false}`.
 *
 * DISCLOSED SCOPE REDUCTION: the baseline component is genuinely two
 * components in one file — a read-only icon renderer, and an "editable"
 * mode that opens `SelectIconDialog` (an icon-picker with its own project/
 * entity-scoped upload flow, `onChangeIcon`, `entityId`, `versionId`,
 * `projectId` props). Every one of those editable-mode props is dead code
 * at this call site (`editable={false}` is passed literally, never a
 * variable). This port keeps only the read-only path: render `icon.component`
 * if given, else `icon.url` as an image, else a per-`entityType` fallback
 * glyph. `SelectIconDialog` is a separate, large feature (icon picker +
 * upload) with no owner in this sub-unit's file list — a future unit that
 * needs an EDITABLE entity icon should build that mode fresh rather than
 * assume this file grows into it.
 *
 * `EntityTypeIcon`'s baseline fallback switch also covers chat-participant
 * types (`ChatParticipantType.Models/Users/Dummy`, `'collection'`,
 * `'skill'`) this call site can never pass — `ToolCard.jsx`'s own
 * `entityType` computation (`ToolCard.jsx:293-299`) only ever produces
 * `'agent' | 'pipeline' | 'toolkit'`. Only those three plus a generic
 * default are ported.
 *
 * The gradient-ring frame (shown behind `icon.component`/the fallback
 * glyph, but NOT behind an `icon.url` image — matching the baseline's own
 * `showBackgroundColor && !hasIconUrl` condition, `EntityIcon.jsx:251`)
 * reuses `shared/ui/GradientIconWrapper` — same
 * `background.icon.entityGradient`/`entityBorderGradient` tokens the
 * baseline's inline `entityIconStyles.container` used — instead of
 * re-deriving the mask-composite CSS. Its default `size` (`2.75rem`) is
 * overridden via `sx` to match the baseline's `2.25rem` avatar exactly (old
 * app: `width/height: '2.25rem'`). `borderRadius: '50%'` becomes
 * `theme.vars.shape.radiusPill` — R-T10 bans the literal (`ad-hoc-radius.mjs`,
 * no exception for `50%`); `radiusPill` (`shape.radiusPill: 9999`) is this
 * app's token for exactly this "true circle" need, per
 * `shared/brand/buildTheme.ts`'s own comment.
 */
export interface EntityIconProps {
  readonly icon?: { readonly component?: ReactNode | undefined; readonly url?: string | undefined } | undefined;
  readonly entityType: 'agent' | 'pipeline' | 'toolkit';
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
        alt={t('agents.entityIcon.previewAlt', 'Preview')}
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
