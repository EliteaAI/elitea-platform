import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { combineSx } from '@/shared/ui/lib/combineSx';
import { InfoTooltip } from '@/shared/ui/InfoTooltip';

/** @public features/pipelines UI — a label with an optional info-icon tooltip, shared by every input-mapping field this sub-unit renders. */
export interface LabelWithTooltipProps {
  readonly tooltip?: ReactNode | undefined;
  /**
   * @default 'Value' — pass `''` explicitly to render the icon alone with
   * no visible text. Passing `undefined` explicitly (rather than omitting
   * the prop) still falls back to `'Value'`: JS default parameters apply
   * whenever the argument is strictly `undefined`, matching the baseline's
   * own behaviour (see this file's own doc comment below).
   *
   * `| undefined` explicit (not just `?`): under `exactOptionalPropertyTypes`,
   * `InputMappingItem.jsx`'s own baseline call site forwards a ternary whose
   * `false` branch is a literal `undefined` (`showTitle ? 'Value' :
   * undefined`) — a plain `title?: string` target rejects that explicit
   * `undefined` argument even though omitting the prop entirely is fine.
   */
  readonly title?: string | undefined;
  readonly sx?: SxProps<Theme> | undefined;
}

const containerSx: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  zIndex: 999,
};

const iconWrapperSx: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  position: 'static',
  bottom: 0,
};

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/InputMappings/LabelWithTooltip.jsx` (baseline, 45 lines) — unit
 * A2i.
 *
 * DEVIATIONS FROM BASELINE, both forced by real, verified constraints:
 *  - The baseline's `infoTooltip={{ title, icon: { fill } }}` config-object
 *    shape (a per-call icon-colour override) is dropped: this app's ported
 *    `InfoTooltip` (unit S1-G) deliberately flattened that polymorphic
 *    shape to a flat `title`/`placement`/`size` surface with no per-call
 *    icon-colour override (see `InfoTooltip.tsx`'s own doc comment). No
 *    call site in this sub-unit's owned files (`InputMappingItem.jsx`,
 *    `VariablesMapping.jsx`) ever passes a non-default `fill` anyway
 *    (grepped: every baseline call site omits it), so this drops an
 *    already-unused knob rather than changing any rendered output.
 *  - Every baseline call site of this component that DOES pass `title`
 *    passes either `''` (suppress the text) or a ternary whose `false`
 *    branch is `undefined` (`title={showTitle ? 'Value' : undefined}`,
 *    `InputMappingItem.jsx`'s `TextInputField`). Because a JS default
 *    parameter fires on a strictly-`undefined` argument regardless of
 *    whether it was passed explicitly or omitted, that ternary always
 *    resolves to the same `'Value'` default either way — a baseline quirk,
 *    not a bug this port silently "fixes". Preserved verbatim at that call
 *    site (see `TextInputField` below) rather than simplified away, so the
 *    rendered output stays byte-for-byte identical to the baseline's.
 */
export function LabelWithTooltip({ tooltip, title = 'Value', sx }: LabelWithTooltipProps): ReactNode {
  return (
    <Box
      component="span"
      sx={combineSx(containerSx, sx)}
    >
      {title && <Typography variant="labelMedium">{title}</Typography>}
      {tooltip && (
        <InfoTooltip
          title={tooltip}
          sx={iconWrapperSx}
        />
      )}
    </Box>
  );
}
