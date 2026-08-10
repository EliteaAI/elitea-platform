/**
 * Hand-rolled cron expression field (spec §2.3, §9.3 unit S7). Replaces
 * `react-js-cron`'s `<Cron>` — rejected because it peers `antd: ">=5.8.0"`,
 * an undeclared second component library (spec §2.6). Built entirely on MUI
 * primitives; parity target is the "Default" mode of `IndexScheduleModal.jsx`
 * (`210-245`) / `PipelineScheduleModal.jsx` (`168-203`) in the old app.
 *
 * Controlled component: `value` is the 5-field cron string, `onChange` fires
 * with the next string on every edit (same contract as react-js-cron's
 * `value`/`setValue` pair, so wiring this into the Wave-2 modals is a
 * drop-in swap). The "Advanced" raw-text mode from the old modals is a
 * plain `TextField` at the call site — generic, already covered by
 * `shared/ui`'s own text-field primitives, so it is Wave-2 modal-wiring
 * scope, not part of this component.
 *
 * Known, waived deviation: the human-readable preview below (`describe.ts`)
 * is hand-rolled, not `cronstrue`-backed like the baseline — see parity item
 * `COPY-511` (`parity/manifest/indexes.json`) for the waiver.
 */
import { useCallback, useMemo, type JSX } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { CronFieldGrid } from './CronFieldGrid';
import { CronPresetSelect } from './CronPresetSelect';
import { describeCronState } from './describe';
import { DEFAULT_EXPRESSION_STATE, type CronExpressionState, type CronFieldId, type CronFieldState } from './model';
import { parseCronExpression } from './parse';
import { findMatchingPresetId } from './presets';
import { serializeCronState } from './serialize';

export interface CronFieldProps {
  /** 5-field cron expression, e.g. `'0 0 * * 6'`. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly id?: string;
  readonly disabled?: boolean;
}

export function CronField(props: CronFieldProps): JSX.Element {
  const { value, onChange, id, disabled = false } = props;

  const parsed = useMemo(() => parseCronExpression(value), [value]);
  const state: CronExpressionState = parsed.ok ? parsed.state : DEFAULT_EXPRESSION_STATE;
  const preview = parsed.ok ? describeCronState(parsed.state) : parsed.error;
  const activePresetId = useMemo(() => findMatchingPresetId(value), [value]);

  const updateField = useCallback(
    (fieldId: CronFieldId, next: CronFieldState) => {
      const nextState: CronExpressionState = { ...state, [fieldId]: next };
      onChange(serializeCronState(nextState));
    },
    [state, onChange],
  );

  return (
    <Box id={id} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <CronPresetSelect activePresetId={activePresetId} onSelect={onChange} disabled={disabled} />

      <CronFieldGrid state={state} onFieldChange={updateField} disabled={disabled} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="bodySmall" color="text.secondary">
          {t('shared.ui.cron.fieldOrder', 'minute – hour – day (month) – month – day (week)')}
        </Typography>
        <Typography
          component="output"
          variant="headingSmall"
          color={parsed.ok ? 'text.secondary' : 'error'}
          aria-live="polite"
        >
          {preview}
        </Typography>
      </Box>
    </Box>
  );
}
