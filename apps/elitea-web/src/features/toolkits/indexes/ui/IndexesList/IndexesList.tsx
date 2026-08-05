import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { PlusIcon } from '@/shared/ui/icons/plus-icon';

import type { IndexRow } from '../../model/indexesStore';
import { IndexListItem } from './IndexListItem';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/ui/
 * IndexesList/index.jsx` (unit A4a) — the left-rail list of indexes with an
 * "add index" button and a loading skeleton state.
 */
export interface IndexesListProps {
  readonly handleAddIndex: () => void;
  readonly indexesList: readonly IndexRow[];
  readonly onIndexClick: (index: IndexRow) => void;
  readonly currentIndex?: IndexRow | null;
  readonly loading?: boolean;
}

const SKELETON_ROW_COUNT = 4;

export function IndexesList(props: IndexesListProps): ReactNode {
  const { handleAddIndex, indexesList, onIndexClick, currentIndex, loading = false } = props;

  return (
    <Box
      sx={{
        width: '16.25rem',
        minWidth: '16.25rem',
        padding: '1rem 1.5rem 1rem 0rem',
        borderRight: (theme) => `.0625rem solid ${theme.vars.palette.divider}`,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <Typography variant="subtitle">INDEXES</Typography>
        <IconButton
          aria-label={t('features.toolkits.indexesList.addIndex', 'Add index')}
          onClick={handleAddIndex}
        >
          <PlusIcon />
        </IconButton>
      </Box>
      {!indexesList.length && !loading ? (
        <Typography
          variant="bodyMedium"
          color="text.disabled"
        >
          {t('features.toolkits.indexesList.empty', 'Still no indexes created')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', flexGrow: 1, height: '100%', maxHeight: '100%' }}>
          {loading
            ? Array.from({ length: SKELETON_ROW_COUNT }).map((_, skeletonIndex) => (
                <IndexListItem
                  useMock
                  key={`skeleton-${skeletonIndex}`}
                  index={{ id: `skeleton-${skeletonIndex}`, metadata: {} }}
                />
              ))
            : indexesList.map((index) => (
                <IndexListItem
                  key={index.id}
                  index={index}
                  onIndexClick={onIndexClick}
                  currentIndex={currentIndex}
                />
              ))}
        </Box>
      )}
    </Box>
  );
}
