/**
 * The per-project activity drawer (unit A14).
 *
 * Reference: `frontends/admin_ui/frontend/src/pages/ProjectsPage/ProjectActivityDrawer.jsx`
 * (read-only) — 601 lines, the largest single component of the reference page.
 *
 * ## Almost all of it is the Audit Trail port, reused
 *
 * The drawer asks the same four audit questions with `project_id` pinned, so it
 * renders `AuditHeatmap`, `AuditTraceTable` and `AuditSpanTable` unchanged and
 * runs on `./api/adminAuditApi` unchanged. What is new here is the layout, the
 * per-member activity strip, and `./useProjectActivityDrawer`'s pinning of the
 * project. That is the first real component reuse in unit A14 — the Users and
 * Audit Trail ports each reused only primitives.
 *
 * ## Two reference behaviours deliberately NOT carried over
 *
 *  - Closing the reference drawer resets the search, the page and the range but
 *    NOT `pageSize`, the sort or the refresh token, so those leaked between
 *    projects: opening project B showed it sorted by whatever project A was
 *    left on. Here the whole hook is remounted per project (`key={project.id}`
 *    on the content), so every field resets together and none can leak.
 *  - The reference's own `project_id` filter box is gone. This drawer describes
 *    the project it was opened for; a box that could change that is the page's
 *    job, and `pages/admin/AuditTrail.tsx` has it.
 */
import CloseIcon from '@mui/icons-material/Close';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { useState } from 'react';

import { DateRangeField } from '@/features/analytics';
import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';
import { t } from '@/shared/i18n';

import { AuditHeatmap } from './AuditHeatmap';
import { AuditSpanTable } from './AuditSpanTable';
import { AuditTraceTable } from './AuditTraceTable';
import { ProjectUserActivity } from './ProjectUserActivity';
import { useProjectMembers, type AdminProjectRow } from './api/adminProjectsApi';
import { DATE_PRESETS } from './auditFormat';
import {
  PROJECT_ACTIVITY_PAGE_SIZE_OPTIONS,
  useProjectActivityDrawer,
} from './useProjectActivityDrawer';

/** How much of a trace id fits in a filter chip before it stops being a label. */
const TRACE_CHIP_LENGTH = 12;

export interface ProjectActivityDrawerProps {
  /** The project to describe, or `null` when the drawer is closed. */
  readonly project: AdminProjectRow | null;
  readonly onClose: () => void;
}

export function ProjectActivityDrawer({ project, onClose }: ProjectActivityDrawerProps) {
  return (
    <Drawer
      anchor="right"
      open={project !== null}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', md: '75vw' } } } }}
    >
      {/*
        Keyed on the project id so every piece of drawer state — range, sort,
        page size, drill-down — is rebuilt per project. See this file's header:
        the reference reset some of them and leaked the rest.

        The `project !== null` check is a TYPE guard, not a behavioural one:
        MUI's Drawer unmounts its children while closed (no `keepMounted`), so
        removing this check changes nothing observable — confirmed by mutation,
        which is why no test can be written to defend it. It stays because
        `ProjectActivityContent` requires a non-null project.
      */}
      {project !== null ? (
        <ProjectActivityContent key={project.id} project={project} onClose={onClose} />
      ) : null}
    </Drawer>
  );
}

function ProjectActivityContent({
  project,
  onClose,
}: {
  readonly project: AdminProjectRow;
  readonly onClose: () => void;
}) {
  const state = useProjectActivityDrawer(project.id);
  const membersQuery = useProjectMembers(project.id);
  // `DateRangeField` is an explicitly-opened picker, so the open state is the
  // caller's to hold — the same contract `AuditTrailFilters` works to.
  const [openPicker, setOpenPicker] = useState<'from' | 'to' | null>(null);

  const { total, page, pageSize } = state;
  const lastPage = total === 0 ? 0 : Math.ceil(total / pageSize) - 1;
  const firstShown = total === 0 ? 0 : page * pageSize + 1;
  const lastShown = Math.min((page + 1) * pageSize, total);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '1rem 1.25rem',
        gap: '0.75rem',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('pages.admin.projects.activity.heading', 'Project activity')}
          </Typography>
          <Typography variant="bodyMedium" color="text.secondary">
            {`${project.name} (ID: ${project.id})`}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: '0.25rem' }}>
          <Tooltip title={t('pages.admin.projects.activity.refresh', 'Refresh')}>
            <IconButton
              size="small"
              onClick={state.onRefresh}
              aria-label={t('pages.admin.projects.activity.refresh', 'Refresh')}
            >
              <RefreshOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton
            size="small"
            onClick={onClose}
            aria-label={t('pages.admin.projects.activity.close', 'Close')}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <SimpleSearchBar
          value={state.search}
          onChange={state.onSearchChange}
          placeholder={t('pages.admin.projects.activity.search', 'Search actions, tools, users')}
          data-testid="project-activity-search"
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

        <Button variant="contained" size="small" startIcon={<SearchOutlinedIcon />} onClick={state.onApply}>
          {t('pages.admin.audit.filter.apply', 'Apply')}
        </Button>
      </Box>

      <Divider />

      <ProjectUserActivity
        members={membersQuery.data ?? []}
        activity={state.userActivity}
        isFetching={membersQuery.isFetching || state.isUserActivityFetching}
        isError={membersQuery.isError || state.isUserActivityError}
      />

      <AuditHeatmap
        heatmap={state.heatmap}
        isFetching={state.isHeatmapFetching}
        viewMode={state.viewMode}
        onCellSelect={state.onCellSelect}
      />

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
        <Alert severity="error">
          {t('pages.admin.projects.activity.loadError', 'Failed to load this project’s activity.')}
        </Alert>
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
              {PROJECT_ACTIVITY_PAGE_SIZE_OPTIONS.map((option) => (
                <MenuItem key={option} value={String(option)}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="bodyMedium" color="text.secondary">
              {`${firstShown}–${lastShown} / ${total}`}
            </Typography>
            <Button size="small" disabled={page === 0} onClick={() => state.onPageChange(page - 1)}>
              {t('pages.admin.audit.pagination.previous', 'Previous')}
            </Button>
            <Button size="small" disabled={page >= lastPage} onClick={() => state.onPageChange(page + 1)}>
              {t('pages.admin.audit.pagination.next', 'Next')}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
