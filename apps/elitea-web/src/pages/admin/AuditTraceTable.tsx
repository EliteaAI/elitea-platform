/**
 * The "Traces" view: one row per `trace_id`, expandable to reveal its spans.
 *
 * A trace's `duration_ms` is the wall clock across the WHOLE trace, not any
 * single span's — a trace of five 30ms spans four seconds apart lasts four
 * seconds. That distinction is why this view and the Spans view are separate
 * queries against separate server endpoints rather than one list grouped on the
 * client, and why the two heatmaps report different totals for the same rows.
 *
 * Expansion loads lazily: the spans of a trace are fetched only when it is
 * opened, from the same `/elitea_core/audit` endpoint the Spans view uses,
 * filtered by `trace_id`.
 */
import { memo, useMemo, useState } from 'react';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import visuallyHidden from '@mui/utils/visuallyHidden';

import { t } from '@/shared/i18n';

import { useAuditSpans, type AuditTraceRow } from './api/adminAuditApi';
import { EventTypeIcon, SortableHeaderCell, StatusCodeCell, TextCell } from './AuditTableParts';
import { formatAction, formatDuration, formatTimestamp } from './auditFormat';

/** Spans per trace in the expanded panel. A trace with more is truncated. */
const SPANS_PER_TRACE = 200;
const TRACE_COLUMN_COUNT = 8;

export interface AuditTraceTableProps {
  readonly rows: readonly AuditTraceRow[];
  readonly sortField: string;
  readonly sortDirection: 'asc' | 'desc';
  readonly onSort: (field: string) => void;
  readonly onTraceSelect: (traceId: string) => void;
}

export const AuditTraceTable = memo(function AuditTraceTable({
  rows,
  sortField,
  sortDirection,
  onSort,
  onTraceSelect,
}: AuditTraceTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (rows.length === 0) {
    return (
      <Box sx={{ padding: '2rem', textAlign: 'center' }}>
        <Typography variant="bodyMedium" color="text.secondary">
          {t('pages.admin.audit.empty.traces', 'No traces found')}
        </Typography>
      </Box>
    );
  }

  const toggle = (traceId: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(traceId)) next.add(traceId);
      return next;
    });
  };

  const sortProps = { sortField, sortDirection, onSort };

  return (
    <TableContainer>
      <Table size="small" aria-label={t('pages.admin.audit.table.traces', 'Audit traces')}>
        <TableHead>
          <TableRow>
            {/*
              The expand column's header still needs a name. An empty `<th>` is
              an axe `empty-table-header` violation (it leaves the row of expand
              buttons in an unnamed column for a screen reader), so the label is
              present and visually hidden rather than absent.
            */}
            <TableCell>
              <Box component="span" sx={visuallyHidden}>
                {t('pages.admin.audit.column.expand', 'Expand')}
              </Box>
            </TableCell>
            <SortableHeaderCell
              field="start_time"
              label={t('pages.admin.audit.column.time', 'Time')}
              {...sortProps}
            />
            <TableCell>{t('pages.admin.audit.column.type', 'Type')}</TableCell>
            <TableCell>{t('pages.admin.audit.column.action', 'Action')}</TableCell>
            <SortableHeaderCell
              field="user_email"
              label={t('pages.admin.audit.column.user', 'User')}
              {...sortProps}
            />
            <SortableHeaderCell
              field="duration_ms"
              label={t('pages.admin.audit.column.duration', 'Duration')}
              {...sortProps}
            />
            <SortableHeaderCell
              field="span_count"
              label={t('pages.admin.audit.column.spans', 'Spans')}
              {...sortProps}
            />
            <SortableHeaderCell
              field="project_id"
              label={t('pages.admin.audit.column.project', 'Project')}
              {...sortProps}
            />
          </TableRow>
        </TableHead>

        <TableBody>
          {rows.map((trace) => (
            <TraceRows
              key={trace.trace_id}
              trace={trace}
              isExpanded={expanded.has(trace.trace_id)}
              onToggle={() => toggle(trace.trace_id)}
              onTraceSelect={onTraceSelect}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
});

interface TraceRowsProps {
  readonly trace: AuditTraceRow;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly onTraceSelect: (traceId: string) => void;
}

function TraceRows({ trace, isExpanded, onToggle, onTraceSelect }: TraceRowsProps) {
  return (
    <>
      <TableRow hover data-testid="audit-trace-row">
        <TableCell padding="checkbox">
          <IconButton
            size="small"
            onClick={onToggle}
            aria-label={
              isExpanded
                ? t('pages.admin.audit.action.collapse', 'Collapse trace')
                : t('pages.admin.audit.action.expand', 'Expand trace')
            }
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell>
          <TextCell>{formatTimestamp(trace.start_time)}</TextCell>
        </TableCell>
        <TableCell>
          <EventTypeIcon eventType={trace.root_event_type} />
        </TableCell>
        <TableCell>
          <Typography
            variant="bodySmall"
            color={trace.has_error ? 'error' : 'text.secondary'}
            component="button"
            onClick={() => onTraceSelect(trace.trace_id)}
            sx={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'start',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {trace.root_action ?? '—'}
          </Typography>
        </TableCell>
        <TableCell>
          <TextCell>{trace.user_email ?? '—'}</TextCell>
        </TableCell>
        <TableCell>
          <TextCell>{formatDuration(trace.duration_ms)}</TextCell>
        </TableCell>
        <TableCell>
          {/*
            The count comes from the server's aggregate, not from the expanded
            panel's length: the panel is lazy and capped, so deriving it here
            would report 0 for every unexpanded trace.
          */}
          <Chip size="small" label={String(trace.span_count)} />
        </TableCell>
        <TableCell>
          <TextCell>{trace.project_id ?? '—'}</TextCell>
        </TableCell>
      </TableRow>

      {isExpanded ? <TraceSpanRows traceId={trace.trace_id} /> : null}
    </>
  );
}

/**
 * The spans of one expanded trace, in the order they started.
 *
 * A separate query rather than a slice of the page's own span list: the page's
 * list is one filtered, paginated window and would in general contain none of
 * this trace's spans at all.
 */
const TraceSpanRows = memo(function TraceSpanRows({ traceId }: { readonly traceId: string }) {
  // Memoised: this object is the query key, so a fresh one per render would
  // refetch forever.
  const params = useMemo(
    () =>
      ({
        limit: SPANS_PER_TRACE,
        offset: 0,
        sortBy: 'timestamp',
        sortOrder: 'asc',
        traceId,
      }) as const,
    [traceId],
  );
  const { data, isFetching } = useAuditSpans(params);

  if (isFetching) {
    return (
      <TableRow>
        <TableCell colSpan={TRACE_COLUMN_COUNT}>
          <Skeleton variant="rectangular" height="2rem" />
        </TableCell>
      </TableRow>
    );
  }

  const spans = data?.rows ?? [];
  if (spans.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={TRACE_COLUMN_COUNT}>
          <Typography variant="bodySmall" color="text.secondary">
            {t('pages.admin.audit.empty.spansOfTrace', 'No spans found for this trace')}
          </Typography>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {spans.map((span) => (
        <TableRow key={span.id} data-testid="audit-trace-span-row" sx={{ backgroundColor: 'action.hover' }}>
          <TableCell />
          <TableCell>
            <TextCell>{formatTimestamp(span.timestamp)}</TextCell>
          </TableCell>
          <TableCell>
            <EventTypeIcon eventType={span.event_type} />
          </TableCell>
          <TableCell>
            <Typography variant="bodySmall" color={span.is_error ? 'error' : 'text.secondary'}>
              {formatAction(span)}
            </Typography>
          </TableCell>
          <TableCell>
            <TextCell>{span.user_email ?? '—'}</TextCell>
          </TableCell>
          <TableCell>
            <TextCell>{formatDuration(span.duration_ms)}</TextCell>
          </TableCell>
          <TableCell>
            <StatusCodeCell statusCode={span.status_code} />
          </TableCell>
          <TableCell>
            <TextCell>{span.project_id ?? '—'}</TextCell>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
});
