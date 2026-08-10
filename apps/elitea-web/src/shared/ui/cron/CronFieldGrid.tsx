/**
 * Lays out the five `CronFieldEditor`s (minute/hour/day/month/weekday) side
 * by side, split out of `CronField.tsx` to keep that file's props (and this
 * one's single responsibility — layout + per-field labels) small.
 */
import type { JSX } from 'react';

import Box from '@mui/material/Box';

import { t } from '@/shared/i18n';
import { CronFieldEditor } from './CronFieldEditor';
import { monthShortLabel, weekdayShortLabel } from './labels';
import { CRON_FIELD_BOUNDS, CRON_FIELD_ORDER, type CronExpressionState, type CronFieldId, type CronFieldState } from './model';

const FIELD_LABELS: Readonly<Record<CronFieldId, { readonly key: string; readonly fallback: string }>> = {
  minute: { key: 'shared.ui.cron.field.minute', fallback: 'Minute' },
  hour: { key: 'shared.ui.cron.field.hour', fallback: 'Hour' },
  dayOfMonth: { key: 'shared.ui.cron.field.dayOfMonth', fallback: 'Day of month' },
  month: { key: 'shared.ui.cron.field.month', fallback: 'Month' },
  dayOfWeek: { key: 'shared.ui.cron.field.dayOfWeek', fallback: 'Day of week' },
};

const OPTION_LABELS: Partial<Record<CronFieldId, (value: number) => string>> = {
  month: monthShortLabel,
  dayOfWeek: weekdayShortLabel,
};

export interface CronFieldGridProps {
  readonly state: CronExpressionState;
  readonly onFieldChange: (fieldId: CronFieldId, next: CronFieldState) => void;
  readonly disabled?: boolean;
}

export function CronFieldGrid(props: CronFieldGridProps): JSX.Element {
  const { state, onFieldChange, disabled = false } = props;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(5, 1fr)' },
        gap: 2,
      }}
    >
      {CRON_FIELD_ORDER.map((fieldId) => {
        const labels = FIELD_LABELS[fieldId];
        return (
          <CronFieldEditor
            key={fieldId}
            fieldId={fieldId}
            label={t(labels.key, labels.fallback)}
            bounds={CRON_FIELD_BOUNDS[fieldId]}
            state={state[fieldId]}
            onChange={(next) => onFieldChange(fieldId, next)}
            disabled={disabled}
            optionLabel={OPTION_LABELS[fieldId]}
          />
        );
      })}
    </Box>
  );
}
