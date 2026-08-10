import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { InfoIcon } from '../../icons/info-icon';
import { t } from '@/shared/i18n';

export interface FieldHeaderProps {
  label: string;
  // Explicit `| undefined` (not just `?:`): every `Common*Field` caller
  // forwards `meta.isRequired`/`meta.description` straight through, and
  // both are themselves optional on `FieldMeta` — under
  // `exactOptionalPropertyTypes`, passing an optional prop's `T | undefined`
  // value to a plain `foo?: T` target is a type error, so every call site
  // would otherwise need its own conditional-spread workaround. Widening
  // the type once here is the one-file fix instead of nine repeats of it.
  required?: boolean | undefined;
  description?: string | undefined;
}

/**
 * Label + optional `" *"` required marker + optional hover-tooltip info
 * icon. Every `Common*Field`/`AnyOfPatternField`/`SecretInputField` baseline
 * file (`apps/elitea-ui/src/[fsd]/shared/ui/field/*.jsx`) repeats this exact
 * `<Typography>{label}{isRequired ? ' *' : ''}</Typography>` +
 * `<InfoTooltip infoTooltip={description} />` pair inline. Extracted once
 * here, in `shared/ui/lib/field/` — a small dedicated subfolder for helpers
 * specific to this unit's field-component family, alongside the app-wide
 * `shared/ui/lib/` (`t.ts`/`combineSx.ts`/`testTheme.tsx`) — and NOT
 * exported from any component's public `index.ts`. This is ordinary in-unit
 * composition, not a cross-unit `shared/ui` primitive, so it does not carry
 * the SecretInputField/`secret-field/` cross-unit-collision risk the brief
 * flags for that specific pairing.
 *
 * Baseline's `InfoTooltip` (`.../tooltip/InfoTooltip.jsx`) also accepts a
 * `ReactElement`/markdown-object `infoTooltip` and renders it through
 * `TooltipMarkdownContent` (the `dompurify`/`marked` markdown family — a
 * different unit's scope). Every field in THIS unit's 9-component scope
 * only ever passes a plain string `description`, so this renders that one
 * case directly instead of porting the polymorphic dispatch.
 *
 * Accessibility fix, not in the baseline (which had the same gap the
 * repo's other R-C1 fixes address — see `BannerMessage`/`BaseCheckbox`):
 * the baseline's tooltip trigger is a bare hoverable `<div>` with no
 * keyboard affordance and no accessible name. This wraps the icon in a
 * real, labelled `IconButton` instead, so it is reachable by `Tab` and has
 * a name a screen reader can announce — required for this unit's stories to
 * clear `a11y.test: 'error'`.
 */
export function FieldHeader({ label, required = false, description }: FieldHeaderProps): ReactNode {
  return (
    <Box
      sx={(theme: Theme) => ({
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: theme.spacing(1),
      })}
    >
      <Typography variant="bodyMedium">
        {label}
        {required ? ' *' : ''}
      </Typography>
      {description !== undefined && description !== '' && (
        <Tooltip title={description}>
          <IconButton
            size="small"
            aria-label={t('shared.ui.field.moreInfo', 'More information')}
            sx={(theme: Theme) => ({ padding: theme.spacing(0.25) })}
          >
            <Box
              component={InfoIcon}
              aria-hidden="true"
              sx={(theme: Theme) => ({
                width: theme.spacing(2),
                height: theme.spacing(2),
                color: theme.vars.palette.icon.fill.secondary,
                fill: theme.vars.palette.icon.fill.secondary,
              })}
            />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
