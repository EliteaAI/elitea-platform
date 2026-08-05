import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';

import { t } from '@/shared/i18n';
import { ArrowLeftIcon } from '@/shared/ui/icons/arrow-left-icon';
import { ArrowRightIcon } from '@/shared/ui/icons/arrow-right-icon';
import { CalendarIcon } from '@/shared/ui/icons/calendar-icon';

/**
 * One `From:`/`To:` field of `AnalyticsContainer`'s date-range filter bar.
 * Extracted from the baseline's two near-identical `DateTimePicker` blocks
 * (`AnalyticsContainer.jsx`'s `datePickerCommonProps` spread over both) —
 * also what brought `AnalyticsContainer`'s own cyclomatic complexity under
 * the `eslint(complexity)` budget (12).
 *
 * FIX (A10-overview-pages cluster, confirmed finding #1): the
 * `DateTimePicker`'s action bar used to unconditionally render a "Clear"
 * button (`actionBar: { actions: ['clear', 'accept'] }`), but the old
 * handler — `(next) => next !== null && onChange(next)` — dropped the
 * `null` that MUI passes to `onChange` on Clear (or on manually blanking
 * the text field), so the button was visible but silently did nothing.
 * Fixed here by adding an optional `onClear` callback: the action bar now
 * only advertises `'clear'` when a caller actually supplies one, and a
 * `null` value is routed to it instead of being swallowed — no more
 * rendered-but-dead button.
 *
 * `onClear` is a separate optional callback rather than widening `onChange`
 * itself to `(value: Date | null) => void`, because this component's only
 * real caller — `AnalyticsContainer` (`src/features/analytics/ui/
 * AnalyticsContainer.tsx`, OUT OF SCOPE for this cluster) — wires
 * `onChange` directly to `setDateFrom`/`setDateTo`
 * (`Dispatch<SetStateAction<Date>>` from `useState<Date>`), and its
 * `toIsoRange`/`presetToDateRange` model (`../model/dateRange.ts`) has no
 * representation of an unbounded/cleared bound: `toIsoRange` always emits a
 * concrete `dateFrom`/`dateTo` pair, consumed as a mandatory range by
 * `useProjectAnalyticsQuery`. Widening `onChange` to accept `null` would
 * both fail to type-check there (`Dispatch<SetStateAction<Date>>` does not
 * accept `null` under `strictFunctionTypes`) and, even if it did, still be
 * a silent no-op one layer up since nothing would consume the `null`.
 * TODO for whoever owns `AnalyticsContainer.tsx`: decide what "clear"
 * should mean for a mandatory date-range filter (e.g. resetting the
 * cleared bound to the active preset's default from `DATE_FILTER_PRESETS`,
 * `../lib/constants.ts`) and pass that decision in as `onClear={...}` on
 * each `DateRangeField`. Until that lands, this component intentionally
 * hides the Clear button instead of repeating the original silently-broken
 * affordance.
 */
export interface DateRangeFieldProps {
  readonly label: string;
  readonly value: Date;
  readonly onChange: (value: Date) => void;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly minDateTime?: Date;
  readonly maxDateTime?: Date;
  /**
   * Optional: when supplied, the picker's action bar shows a working
   * "Clear" button that calls this (instead of dropping the value). Omitted
   * (the current `AnalyticsContainer` caller) → no Clear button is shown at
   * all, see this file's header doc comment.
   */
  readonly onClear?: () => void;
}

const fieldSx = (theme: Theme, active: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  borderBottom: `0.0625rem solid ${active ? theme.vars.palette.primary.main : theme.vars.palette.border.lines}`,
  padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
  height: '1.75rem',
  boxSizing: 'border-box' as const,
});

const labelSx = (theme: Theme) => ({
  color: theme.vars.palette.text.default,
  fontSize: theme.typography.labelSmall.fontSize,
  fontWeight: 500,
  lineHeight: '1rem',
  whiteSpace: 'nowrap' as const,
});

function DateRangeFieldImpl({
  label,
  value,
  onChange,
  open,
  onOpen,
  onClose,
  minDateTime,
  maxDateTime,
  onClear,
}: DateRangeFieldProps): ReactNode {
  return (
    <Box sx={(theme: Theme) => fieldSx(theme, open)}>
      <Typography sx={labelSx}>{label}</Typography>
      <DateTimePicker
        value={value}
        onChange={(next) => {
          if (next === null) {
            onClear?.();
            return;
          }
          onChange(next);
        }}
        open={open}
        onOpen={onOpen}
        onClose={onClose}
        {...(minDateTime !== undefined ? { minDateTime } : {})}
        {...(maxDateTime !== undefined ? { maxDateTime } : {})}
        ampm={false}
        format="dd/MM/yyyy HH:mm"
        localeText={{ okButtonLabel: t('analytics.dateRange.apply', 'Apply') }}
        slots={{
          openPickerIcon: CalendarIcon,
          leftArrowIcon: ArrowLeftIcon,
          rightArrowIcon: ArrowRightIcon,
        }}
        slotProps={{
          textField: { size: 'small', variant: 'standard' },
          actionBar: { actions: onClear !== undefined ? ['clear', 'accept'] : ['accept'] },
        }}
      />
    </Box>
  );
}

export const DateRangeField = memo(DateRangeFieldImpl);
