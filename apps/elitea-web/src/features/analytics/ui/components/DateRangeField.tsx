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
}: DateRangeFieldProps): ReactNode {
  return (
    <Box sx={(theme: Theme) => fieldSx(theme, open)}>
      <Typography sx={labelSx}>{label}</Typography>
      <DateTimePicker
        value={value}
        onChange={(next) => next !== null && onChange(next)}
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
          actionBar: { actions: ['clear', 'accept'] },
        }}
      />
    </Box>
  );
}

export const DateRangeField = memo(DateRangeFieldImpl);
