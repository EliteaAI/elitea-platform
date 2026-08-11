/**
 * The "Spans" view: one row per `centry.audit_events` row.
 *
 * Every column reads a real column of that table. `action` is clickable when
 * the span carries a `trace_id`, which filters the whole page down to that
 * trace — and is NOT rendered as a link when it does not, rather than as a
 * link that goes nowhere.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import type { AuditSpanRow } from './api/adminAuditApi';
import { EventTypeIcon, SortableHeaderCell, StatusCodeCell, TextCell } from './AuditTableParts';
import { formatAction, formatDuration, formatTimestamp } from './auditFormat';

export interface AuditSpanTableProps {
  readonly rows: readonly AuditSpanRow[];
  readonly sortField: string;
  readonly sortDirection: 'asc' | 'desc';
  readonly onSort: (field: string) => void;
  readonly onTraceSelect: (traceId: string) => void;
}

export const AuditSpanTable = memo(function AuditSpanTable({
  rows,
  sortField,
  sortDirection,
  onSort,
  onTraceSelect,
}: AuditSpanTableProps) {
  if (rows.length === 0) {
    return (
      <Box sx={{ padding: '2rem', textAlign: 'center' }}>
        <Typography variant="bodyMedium" color="text.secondary">
          {t('pages.admin.audit.empty.spans', 'No audit events')}
        </Typography>
      </Box>
    );
  }

  const sortProps = { sortField, sortDirection, onSort };

  return (
    <TableContainer>
      <Table size="small" aria-label={t('pages.admin.audit.table.spans', 'Audit events')}>
        <TableHead>
          <TableRow>
            <SortableHeaderCell
              field="timestamp"
              label={t('pages.admin.audit.column.time', 'Time')}
              {...sortProps}
            />
            <SortableHeaderCell
              field="event_type"
              label={t('pages.admin.audit.column.type', 'Type')}
              {...sortProps}
            />
            <SortableHeaderCell
              field="action"
              label={t('pages.admin.audit.column.action', 'Action')}
              {...sortProps}
            />
            <SortableHeaderCell
              field="user_email"
              label={t('pages.admin.audit.column.user', 'User')}
              {...sortProps}
            />
            <SortableHeaderCell
              field="status_code"
              label={t('pages.admin.audit.column.status', 'Status')}
              {...sortProps}
            />
            <SortableHeaderCell
              field="duration_ms"
              label={t('pages.admin.audit.column.duration', 'Duration')}
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
          {rows.map((row) => (
            <TableRow key={row.id} hover data-testid="audit-span-row">
              <TableCell>
                <TextCell>{formatTimestamp(row.timestamp)}</TextCell>
              </TableCell>
              <TableCell>
                <EventTypeIcon eventType={row.event_type} />
              </TableCell>
              <TableCell>
                {row.trace_id ? (
                  <Link
                    component="button"
                    type="button"
                    variant="bodySmall"
                    color={row.is_error ? 'error' : 'text.secondary'}
                    onClick={() => onTraceSelect(row.trace_id ?? '')}
                  >
                    {formatAction(row)}
                  </Link>
                ) : (
                  <Typography variant="bodySmall" color={row.is_error ? 'error' : 'text.secondary'}>
                    {formatAction(row)}
                  </Typography>
                )}
              </TableCell>
              <TableCell>
                <TextCell>{row.user_email ?? '—'}</TextCell>
              </TableCell>
              <TableCell>
                <StatusCodeCell statusCode={row.status_code} />
              </TableCell>
              <TableCell>
                <TextCell>{formatDuration(row.duration_ms)}</TextCell>
              </TableCell>
              <TableCell>
                <TextCell>{row.project_id ?? '—'}</TextCell>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
});
