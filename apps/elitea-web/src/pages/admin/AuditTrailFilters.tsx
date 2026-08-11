/**
 * The audit trail's filter bar: quick date presets, an explicit From/To range,
 * event type, project, user, an errors-only switch, Apply and Refresh.
 *
 * Everything here edits a DRAFT — see `useAdminAuditTrailPage`'s header for why
 * this surface does not query on every keystroke.
 *
 * `DateRangeField` is reused from `features/analytics`: same MUI
 * `DateTimePicker`, same controlled `Date` contract, and it already carries the
 * fix for the picker's silently-dead "Clear" button. Its date PRESETS are not
 * reused — those are four rolling day-count windows, while this page mixes
 * rolling clock windows with calendar days snapped to local midnight (see
 * `auditFormat.ts`).
 */
import { memo, useState } from 'react';

import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';

import { DateRangeField } from '@/features/analytics';
import { t } from '@/shared/i18n';

import { SYSTEM_EVENT_TYPES, USER_EVENT_TYPES } from './api/adminAuditApi';
import { DATE_PRESETS } from './auditFormat';
import type { AuditDraftFilters, AuditTab } from './useAdminAuditTrailPage';

/**
 * Display names for the event types. Keyed by the wire value, so an event type
 * the server grows that this map has not learned still renders — as its raw
 * value, which is informative, rather than as a blank cell.
 */
export function eventTypeLabel(eventType: string): string {
  const labels: Record<string, string> = {
    api: t('pages.admin.audit.type.api', 'API'),
    socketio: t('pages.admin.audit.type.socketio', 'Socket.IO'),
    rpc: t('pages.admin.audit.type.rpc', 'RPC'),
    agent: t('pages.admin.audit.type.agent', 'Agent'),
    tool: t('pages.admin.audit.type.tool', 'Tool'),
    llm: t('pages.admin.audit.type.llm', 'LLM'),
    schedule: t('pages.admin.audit.type.schedule', 'Schedule'),
    admin_task: t('pages.admin.audit.type.adminTask', 'Admin Task'),
  };
  return labels[eventType] ?? eventType;
}

export interface AuditTrailFiltersProps {
  readonly filters: AuditDraftFilters;
  readonly tab: AuditTab;
  readonly activePreset: string | null;
  readonly onChange: <TKey extends keyof AuditDraftFilters>(
    field: TKey,
    value: AuditDraftFilters[TKey],
  ) => void;
  readonly onPresetSelect: (label: string) => void;
  readonly onApply: () => void;
  readonly onRefresh: () => void;
}

export const AuditTrailFilters = memo(function AuditTrailFilters({
  filters,
  tab,
  activePreset,
  onChange,
  onPresetSelect,
  onApply,
  onRefresh,
}: AuditTrailFiltersProps) {
  // `DateRangeField` is an explicitly-opened picker, so the open state is the
  // caller's to hold.
  const [openPicker, setOpenPicker] = useState<'from' | 'to' | null>(null);

  // The two tabs offer different types, because they ARE different sets: the
  // server is asked for the whole set when none is chosen.
  const typeOptions = tab === 'user' ? USER_EVENT_TYPES : SYSTEM_EVENT_TYPES;

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onApply();
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {DATE_PRESETS.map((preset) => (
          <Chip
            key={preset.label}
            label={preset.label}
            size="small"
            variant={activePreset === preset.label ? 'filled' : 'outlined'}
            color={activePreset === preset.label ? 'primary' : 'default'}
            onClick={() => onPresetSelect(preset.label)}
          />
        ))}

        {/*
          `DateRangeField` does NOT provide its own localization context — it
          reads one, and MUI X throws outright when there is none. Its only
          other caller (`AnalyticsContainer`) supplies it at its own root, so
          this is the caller's job rather than something inherited from
          `AppProviders`. Omitting it takes the whole page down at render.
        */}
        <LocalizationProvider dateAdapter={AdapterDateFns}>
          <DateRangeField
            label={t('pages.admin.audit.filter.from', 'From')}
            value={filters.dateFrom}
            onChange={(value) => onChange('dateFrom', value)}
            open={openPicker === 'from'}
            onOpen={() => setOpenPicker('from')}
            onClose={() => setOpenPicker(null)}
            maxDateTime={filters.dateTo}
          />
          <DateRangeField
            label={t('pages.admin.audit.filter.to', 'To')}
            value={filters.dateTo}
            onChange={(value) => onChange('dateTo', value)}
            open={openPicker === 'to'}
            onOpen={() => setOpenPicker('to')}
            onClose={() => setOpenPicker(null)}
            minDateTime={filters.dateFrom}
          />
        </LocalizationProvider>

        <Button variant="contained" size="small" startIcon={<SearchOutlinedIcon />} onClick={onApply}>
          {t('pages.admin.audit.filter.apply', 'Apply')}
        </Button>

        <Tooltip title={t('pages.admin.audit.filter.refresh', 'Refresh')}>
          <IconButton
            size="small"
            onClick={onRefresh}
            aria-label={t('pages.admin.audit.filter.refresh', 'Refresh')}
          >
            <RefreshOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label={t('pages.admin.audit.filter.type', 'Type')}
          value={filters.eventType}
          onChange={(event) => onChange('eventType', event.target.value)}
          sx={{ minWidth: '9rem' }}
        >
          <MenuItem value="">{t('pages.admin.audit.filter.allTypes', 'All')}</MenuItem>
          {typeOptions.map((eventType) => (
            <MenuItem key={eventType} value={eventType}>
              {eventTypeLabel(eventType)}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          size="small"
          label={t('pages.admin.audit.filter.project', 'Project')}
          value={filters.projectId}
          onChange={(event) => onChange('projectId', event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          sx={{ width: '8rem' }}
        />

        <TextField
          size="small"
          label={t('pages.admin.audit.filter.user', 'User')}
          value={filters.userId}
          onChange={(event) => onChange('userId', event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          sx={{ width: '8rem' }}
        />

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={filters.onlyErrors}
              onChange={(event) => onChange('onlyErrors', event.target.checked)}
            />
          }
          label={t('pages.admin.audit.filter.errorsOnly', 'Errors only')}
        />
      </Box>
    </Box>
  );
});
