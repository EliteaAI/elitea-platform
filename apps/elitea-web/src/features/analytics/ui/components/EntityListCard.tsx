import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { combineSx } from '@/shared/ui/lib/combineSx';

/**
 * Generic "card with a header-table of unknown-shaped rows" — shared by the
 * three detail screens' sibling `users`/`tools`/`agents` lists (baseline:
 * `AnalyticsAgentDetailed.jsx`'s Users/Tools cards,
 * `AnalyticsToolDetailed.jsx`'s Users/Agents cards). Every row is one of the
 * `AnalyticsDetailEnvelope`'s `zod.looseObject({})` sibling-array entries —
 * see `lib/looseRecord.ts`'s header for why the row type is generic here.
 */
export interface EntityListColumn {
  readonly header: string;
  readonly flex: number;
  readonly render: (row: Readonly<Record<string, unknown>>) => ReactNode;
}

export interface EntityListCardProps {
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly rowKey: (row: Readonly<Record<string, unknown>>, index: number) => string;
  readonly columns: readonly EntityListColumn[];
  readonly emptyText: string;
}

const cardSx = (theme: Theme) => ({
  padding: theme.spacing(2),
  borderRadius: theme.vars.shape.radiusMd,
  backgroundColor: theme.vars.palette.background.userInputBackground,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
});

const titleSx = (theme: Theme) => ({
  color: theme.vars.palette.text.secondary,
  marginBottom: theme.spacing(0.5),
  display: 'block',
});

const subtitleSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  fontSize: theme.typography.labelSmall.fontSize,
  marginBottom: theme.spacing(1),
  display: 'block',
});

const headerRowSx = (theme: Theme) => ({
  display: 'flex',
  padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  gap: theme.spacing(1),
});

const headerCellSx = (theme: Theme) => ({
  fontSize: theme.typography.labelSmall.fontSize,
  fontWeight: 600,
  color: theme.vars.palette.text.metrics,
  textTransform: 'uppercase',
});

const scrollListSx: SxProps<Theme> = { height: 300, overflowY: 'auto', overflowX: 'hidden' };

const dataRowSx = (theme: Theme) => ({
  display: 'flex',
  padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
  borderBottom: `1px solid ${theme.vars.palette.border.table}`,
  gap: theme.spacing(1),
  '&:hover': { backgroundColor: theme.vars.palette.background.conversation.hover },
});

const emptyTextSx = (theme: Theme) => ({ color: theme.vars.palette.text.metrics });

function EntityListCardImpl({ title, subtitle, rows, rowKey, columns, emptyText }: EntityListCardProps): ReactNode {
  return (
    <Box sx={cardSx}>
      <Typography
        variant="labelMedium"
        sx={titleSx}
      >
        {title}
      </Typography>
      <Typography
        variant="bodySmall"
        sx={subtitleSx}
      >
        {subtitle}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'auto' }}>
        <Box sx={headerRowSx}>
          {columns.map((column) => (
            <Typography
              key={column.header}
              sx={combineSx(headerCellSx, { flex: column.flex })}
            >
              {column.header}
            </Typography>
          ))}
        </Box>
        <Box sx={scrollListSx}>
          {rows.map((row, index) => (
            <Box
              key={rowKey(row, index)}
              sx={dataRowSx}
            >
              {columns.map((column) => (
                <Box
                  key={column.header}
                  sx={{ flex: column.flex, minWidth: 0 }}
                >
                  {column.render(row)}
                </Box>
              ))}
            </Box>
          ))}
          {rows.length === 0 && (
            <Typography
              variant="bodySmall"
              sx={emptyTextSx}
            >
              {emptyText}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export const EntityListCard = memo(EntityListCardImpl);
