import type { ReactNode } from 'react';
import { useMemo } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Skeleton from '@mui/material/Skeleton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { format } from 'date-fns';

import { t } from '@/shared/i18n';
import { AttentionIcon } from '@/shared/ui/icons/attention-icon';
import { ClockIcon } from '@/shared/ui/icons/clock-icon';
import { FileIcon } from '@/shared/ui/icons/file-icon';
import { InfoTooltip } from '@/shared/ui/InfoTooltip';
import { StopIcon } from '@/shared/ui/icons/stop-icon';

import { IndexStatuses } from '../../lib/constants/indexDetails.constants';
import { toDisplayString } from '../../lib/helpers/displayString.local';
import type { IndexRow } from '../../model/indexesStore';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/ui/
 * IndexesList/IndexListItem.jsx` (unit A4a). One row of the indexes
 * sidebar: name, created date, indexed/reindexed/skipped counts, and a
 * status glyph.
 */
export interface IndexListItemProps {
  readonly index: IndexRow;
  readonly onIndexClick?: ((index: IndexRow) => void) | undefined;
  readonly currentIndex?: IndexRow | null | undefined;
  readonly useMock?: boolean | undefined;
}

interface SkippedMeta {
  readonly total_skipped?: number;
}

/** Extracted to a standalone function (not inlined in JSX) — matches `features/pipelines/ui/state/RunStateDialog.tsx`'s identical `format(...)` extraction, which keeps the date-fns pattern string out of a JSX expression container. */
function formatCreatedOn(createdOn: number | undefined): string {
  if (createdOn === undefined) return '–';
  return format(new Date(createdOn * 1000), 'dd.MM.yyyy');
}

function parseSkipped(raw: unknown): SkippedMeta {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SkippedMeta;
    } catch {
      return { total_skipped: 0 };
    }
  }
  if (raw && typeof raw === 'object') return raw;
  return { total_skipped: 0 };
}

export function IndexListItem(props: IndexListItemProps): ReactNode {
  const { index, onIndexClick, currentIndex, useMock } = props;

  const isSelected = useMemo(() => currentIndex?.id === index.id, [currentIndex, index]);

  const documents = useMemo(() => {
    const metadata = index.metadata;
    if (!metadata || Object.keys(metadata).length === 0) return { tooltip: '-', count: '–', skipped: 0 };

    const skipped = parseSkipped(metadata['skipped']);
    const history = metadata['history'] as readonly unknown[] | undefined;
    const updated = metadata['updated'];
    const indexed = metadata['indexed'];

    if (history && history.length > 1 && updated !== undefined) {
      return { tooltip: 'reindexed / total indexed', count: `${toDisplayString(updated)} / ${toDisplayString(indexed)}`, skipped: skipped.total_skipped ?? 0 };
    }

    return { tooltip: 'total indexed', count: indexed !== undefined ? toDisplayString(indexed) : '–', skipped: skipped.total_skipped ?? 0 };
  }, [index]);

  if (useMock) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '.25rem', width: '100%', height: '4rem', padding: '.375rem 1rem' }}>
        <Skeleton
          data-testid="index-list-item-skeleton"
          variant="text"
          width="70%"
          height={20}
        />
        <Skeleton
          data-testid="index-list-item-skeleton"
          variant="text"
          width="50%"
          height={20}
        />
      </Box>
    );
  }

  const state = index.metadata['state'];
  const createdOn = index.metadata['created_on'] as number | undefined;
  const isProgressError = Boolean(index['stale']) && state === IndexStatuses.progress;

  return (
    <Box
      onClick={() => onIndexClick?.(index)}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        width: '100%',
        height: '4rem',
        borderRadius: (theme) => theme.vars.shape.radiusMd,
        padding: '.375rem 1rem',
        // `isProgressError` checked FIRST, `isSelected` second — matches the
        // baseline's sx-array ordering (`wrapper`, then `selectedWrapper` if
        // selected, then `errorWrapper` LAST if stale+in-progress, plus
        // `errorWrapper`'s own `'&.selected'` sub-rule), which keeps the red
        // error styling on a row even when it is simultaneously selected
        // (`IndexListItem.jsx` lines 66-70, 191-197). Reversing this
        // precedence (selected-first) would let a plain "selected" style win
        // and silently drop the error/stale indicator the baseline
        // deliberately preserves.
        border: (theme) => `.0625rem solid ${isProgressError ? theme.vars.palette.error.main : isSelected ? theme.vars.palette.action.selected : 'transparent'}`,
        background: (theme) => (isProgressError ? theme.vars.palette.error.light : isSelected ? theme.vars.palette.action.selected : theme.vars.palette.action.hover),
        position: 'relative',
        gap: '.25rem',
        cursor: 'pointer',
      }}
    >
      <Typography
        variant="bodyMedium"
        color="text.secondary"
      >
        {toDisplayString(index.metadata['collection'])}
      </Typography>
      <Box sx={{ display: 'flex', gap: '0.5rem' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap', gap: '0.5rem' }}>
          <ClockIcon />
          <Typography variant="bodySmall2">{formatCreatedOn(createdOn)}</Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap', gap: '0.5rem' }}>
          <FileIcon />
          <Tooltip title={documents.tooltip}>
            <Typography variant="bodySmall2">{documents.count}</Typography>
          </Tooltip>
        </Box>

        {Number(documents.skipped) > 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap', gap: '0.5rem' }}>
            <AttentionIcon
              width={16}
              height={16}
            />
            <Tooltip title={t('features.toolkits.indexListItem.skippedTooltip', 'total skipped during indexing')}>
              <Typography
                variant="bodySmall2"
                color="warning.main"
              >
                {documents.skipped}
              </Typography>
            </Tooltip>
          </Box>
        )}
      </Box>
      {state === IndexStatuses.progress && (
        <CircularProgress
          size={14}
          thickness={5}
          sx={{ position: 'absolute', top: '50%', right: '1rem', marginTop: '-.4375rem' }}
        />
      )}
      {state === IndexStatuses.fail && (
        <InfoTooltip
          title={t('features.toolkits.indexListItem.processingError', 'Index processing error')}
          disableTooltip
          sx={{ position: 'absolute', top: '50%', right: '1rem', marginTop: '-.4375rem', color: 'error.main' }}
        />
      )}
      {state === IndexStatuses.cancelled && (
        <Box sx={{ position: 'absolute', top: '50%', right: '1rem', marginTop: '-.4375rem', color: 'warning.main' }}>
          <StopIcon
            width={16}
            height={16}
          />
        </Box>
      )}
      {state === IndexStatuses.partlyOk && (
        <Box sx={{ position: 'absolute', top: '50%', right: '1rem', marginTop: '-.4375rem', color: 'warning.main' }}>
          <AttentionIcon
            width={16}
            height={16}
          />
        </Box>
      )}
    </Box>
  );
}
