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
 * Local duplicate of `features/agents/ui/EntityIcon.tsx` (byte-for-byte,
 * `no-sideways-features` forbids importing it), itself a scoped port of
 * `apps/elitea-ui/src/components/EntityIcon.jsx` (`EntityIcon` +
 * `EntityTypeIcon`), for `NameDescriptionInput.tsx`'s ONE call site
 * (`ui/form/NameDescriptionInput.jsx:59-66`), which always passes
 * `editable={false}`.
 *
 * DISCLOSED SCOPE REDUCTION (same as the sibling copy): only the read-only
 * path is ported — render `icon.component` if given, else `icon.url` as an
 * image, else a per-`entityType` fallback glyph. `SelectIconDialog` (the
 * baseline's "editable" icon-picker mode) has no port anywhere in this app;
 * see the sibling file's own doc comment for the full rationale, not
 * re-litigated here.
 *
 * The baseline's `EntityTypeIcon` fallback switch also covers an `'mcp'`
 * entity type (`NameDescriptionInput.jsx:62`: `entityType={!isMCP ?
 * 'toolkit' : 'mcp'}`) that the AGENTS copy's `entityType` union never
 * needed (its one caller, `ToolCard.jsx`, only ever produces `'agent' |
 * 'pipeline' | 'toolkit'`). Rather than fork this shared shape to add a
 * fourth branch for one caller, `NameDescriptionInput.tsx` maps its `isMCP`
 * case to `'toolkit'` at the call site — the baseline's own MCP fallback
 * glyph (`components/EntityIcon.jsx`'s `'mcp'` case) reused the toolkit-type
 * `getToolIconByType` per-brand icon, itself a documented, disclosed gap
 * with no port anywhere (`features/toolkits/lib/helpers/toolkits.helpers.ts`'s
 * own module doc comment, point 4) — `'toolkit'`'s generic `ToolIcon`
 * fallback is the closest available substitute, not a silent behaviour
 * change from a working baseline path.
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
        alt={t('toolkits.entityIcon.previewAlt', 'Preview')}
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
