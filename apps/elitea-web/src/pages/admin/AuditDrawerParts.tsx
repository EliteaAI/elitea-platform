/**
 * The chrome both admin activity drawers share — the per-project one
 * (`ProjectActivityDrawer`) and the per-user one (`UserActivityDrawer`).
 *
 * The two drawers differ in their heading, in what they pin, and in whether a
 * per-member strip sits between the filters and the chart. The filter bar and
 * the results block below it are the same controls over the same
 * `useAuditDrawer` state, so they live here once rather than being copied with
 * a different `data-testid` — the copy is how the reference ended up with two
 * date bars that drifted apart.
 */
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { useState } from 'react';

import { DateRangeField } from '@/features/analytics';
import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';
import { t } from '@/shared/i18n';

import { AuditSpanTable } from './AuditSpanTable';
import { AuditTraceTable } from './AuditTraceTable';
import { DATE_PRESETS } from './auditFormat';
import { AUDIT_DRAWER_PAGE_SIZE_OPTIONS, type AuditDrawerState } from './useAuditDrawer';

/** How much of a trace id fits in a filter chip before it stops being a label. */
const TRACE_CHIP_LENGTH = 12;

export interface AuditDrawerFiltersProps {
  readonly state: AuditDrawerState;
  readonly searchPlaceholder: string;
  readonly searchTestId: string;
}

/** Search + active drill-down chips + the draft date range and its presets. */
export function AuditDrawerFilters({ state, searchPlaceholder, searchTestId }: AuditDrawerFiltersProps) {
  // `DateRangeField` is an explicitly-opened picker, so the open state is the
  // caller's to hold — the same contract `AuditTrailFilters` works to.
  const [openPicker, setOpenPicker] = useState<'from' | 'to' | null>(null);

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <SimpleSearchBar
          value={state.search}
          onChange={state.onSearchChange}
          placeholder={searchPlaceholder}
          data-testid={searchTestId}
          sx={{ width: '18rem' }}
        />
        {/*
          Active drill-downs, each removable. They are shown because they change
          what the tables below contain: a filter applied invisibly is a table
          that looks like it lost most of its rows.
        */}
        {state.traceFilter ? (
          <Chip
            size="small"
            label={`${t('pages.admin.audit.chip.trace', 'trace')}: ${state.traceFilter.slice(0, TRACE_CHIP_LENGTH)}…`}
            onDelete={state.onClearTrace}
          />
        ) : null}
        {state.cellFilter ? (
          <Chip
            size="small"
            color="primary"
            label={`${state.cellFilter.timeLabel} · ${state.cellFilter.bandLabel}`}
            onDelete={state.onClearCell}
          />
        ) : null}
      </Box>

      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') state.onApply();
        }}
      >
        {DATE_PRESETS.map((preset) => (
          <Chip
            key={preset.label}
            label={preset.label}
            size="small"
            variant={state.activePreset === preset.label ? 'filled' : 'outlined'}
            color={state.activePreset === preset.label ? 'primary' : 'default'}
            onClick={() => state.onPresetSelect(preset.label)}
          />
        ))}

        {/*
          `DateRangeField` does NOT provide its own localization context — it
          reads one, and MUI X throws outright when there is none. Supplying it
          here is the caller's job, exactly as in `AuditTrailFilters`; omitting
          it takes the drawer down at render.
        */}
        <LocalizationProvider dateAdapter={AdapterDateFns}>
          <DateRangeField
            label={t('pages.admin.audit.filter.from', 'From')}
            value={state.draftRange.dateFrom}
            onChange={(value) => state.onRangeChange('dateFrom', value)}
            open={openPicker === 'from'}
            onOpen={() => setOpenPicker('from')}
            onClose={() => setOpenPicker(null)}
            maxDateTime={state.draftRange.dateTo}
          />
          <DateRangeField
            label={t('pages.admin.audit.filter.to', 'To')}
            value={state.draftRange.dateTo}
            onChange={(value) => state.onRangeChange('dateTo', value)}
            open={openPicker === 'to'}
            onOpen={() => setOpenPicker('to')}
            onClose={() => setOpenPicker(null)}
            minDateTime={state.draftRange.dateFrom}
          />
        </LocalizationProvider>

        <Button variant="elitea" color="primary" size="small" startIcon={<SearchOutlinedIcon />} onClick={state.onApply}>
          {t('pages.admin.audit.filter.apply', 'Apply')}
        </Button>
      </Box>
    </>
  );
}

export interface AuditDrawerResultsProps {
  readonly state: AuditDrawerState;
  /** Shown INSTEAD of the tables when the active listing failed. */
  readonly errorMessage: string;
}

/** The trace/span switch, the active table, and its pagination footer. */
export function AuditDrawerResults({ state, errorMessage }: AuditDrawerResultsProps) {
  const { total, page, pageSize } = state;
  const lastPage = total === 0 ? 0 : Math.ceil(total / pageSize) - 1;
  const firstShown = total === 0 ? 0 : page * pageSize + 1;
  const lastShown = Math.min((page + 1) * pageSize, total);

  return (
    <>
      <Tabs value={state.viewMode} onChange={state.onViewModeChange} sx={{ minHeight: '2.5rem' }}>
        <Tab
          value="traces"
          label={t('pages.admin.audit.view.traces', 'Traces')}
          sx={{ textTransform: 'none', minHeight: '2.5rem' }}
        />
        <Tab
          value="spans"
          label={t('pages.admin.audit.view.spans', 'Spans')}
          sx={{ textTransform: 'none', minHeight: '2.5rem' }}
        />
      </Tabs>

      {state.isError ? (
        <Alert severity="error">{errorMessage}</Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <Box sx={{ height: '0.25rem' }}>{state.isFetching ? <LinearProgress /> : null}</Box>

          {state.viewMode === 'traces' ? (
            <AuditTraceTable
              rows={state.traceRows}
              sortField={state.sortField}
              sortDirection={state.sortDirection}
              onSort={state.onSort}
              onTraceSelect={state.onTraceSelect}
            />
          ) : (
            <AuditSpanTable
              rows={state.spanRows}
              sortField={state.sortField}
              sortDirection={state.sortDirection}
              onSort={state.onSort}
              onTraceSelect={state.onTraceSelect}
            />
          )}

          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '0.75rem',
              paddingTop: '0.5rem',
            }}
          >
            <TextField
              select
              size="small"
              label={t('pages.admin.audit.pagination.pageSize', 'Rows')}
              value={String(pageSize)}
              onChange={(event) => state.onPageSizeChange(Number(event.target.value))}
              sx={{ width: '6rem' }}
            >
              {AUDIT_DRAWER_PAGE_SIZE_OPTIONS.map((option) => (
                <MenuItem key={option} value={String(option)}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="bodyMedium" color="text.secondary">
              {`${firstShown}–${lastShown} / ${total}`}
            </Typography>
            <Button
              variant="elitea"
              color="tertiary"
              size="small"
              disabled={page === 0}
              onClick={() => state.onPageChange(page - 1)}
            >
              {t('pages.admin.audit.pagination.previous', 'Previous')}
            </Button>
            <Button
              variant="elitea"
              color="tertiary"
              size="small"
              disabled={page >= lastPage}
              onClick={() => state.onPageChange(page + 1)}
            >
              {t('pages.admin.audit.pagination.next', 'Next')}
            </Button>
          </Box>
        </Box>
      )}
    </>
  );
}
