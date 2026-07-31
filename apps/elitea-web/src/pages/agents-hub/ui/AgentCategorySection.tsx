/**
 * Agent Category Section — renders cards for a single category bucket.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent-hub/ui/AgentCategorySection.jsx`.
 *
 * Deviations:
 *  - No tour IDs.
 *  - Uses Box/img for icons instead of EntityIcon.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

const IconButtonAny = IconButton as React.ComponentType<
  React.ComponentProps<typeof IconButton> & { variant?: string }
>;

import RefreshIcon from '@/shared/ui/icons/svg/refresh-icon.svg?react';

import AgentCard from './AgentCard';
import type { ApplicationData } from '../types';

export interface AgentCategorySectionProps {
  category: string;
  items: ApplicationData[];
  totalCount?: number | undefined;
  isLoading?: boolean | undefined;
  isLoadingMore?: boolean | undefined;
  onSelectItem?: ((app: ApplicationData) => void) | undefined;
  onLoadMore?: ((category: string) => void) | undefined;
  onRefresh?: ((category: string) => void) | undefined;
}

const INITIAL_DISPLAY_COUNT = 8;

const AgentCategorySection = memo(
  ({
    category,
    items,
    totalCount = 0,
    isLoading = false,
    isLoadingMore = false,
    onSelectItem,
    onLoadMore,
    onRefresh,
  }: AgentCategorySectionProps) => {
    const [displayCount, setDisplayCount] = useState(INITIAL_DISPLAY_COUNT);

    useEffect(() => {
      if (!items.length) setDisplayCount(INITIAL_DISPLAY_COUNT);
    }, [items.length]);

    const visibleItems = useMemo(() => items.slice(0, displayCount), [items, displayCount]);
    const hasMoreLocally = items.length > displayCount;
    const canShowMore = hasMoreLocally || items.length < totalCount;
    const isExpanded = displayCount > INITIAL_DISPLAY_COUNT;
    const shouldShowButton = (canShowMore || isExpanded) && !isLoadingMore;

    const handleShowMore = useCallback(() => {
      const newCount = displayCount + INITIAL_DISPLAY_COUNT;
      setDisplayCount(newCount);
      if (newCount > items.length && items.length < totalCount) {
        onLoadMore?.(category);
      }
    }, [displayCount, items.length, totalCount, onLoadMore, category]);

    const handleShowLess = useCallback(() => {
      setDisplayCount(INITIAL_DISPLAY_COUNT);
    }, []);

    return (
      <Box sx={styles.container}>
        <Box sx={styles.header}>
          <Typography variant="headingMedium" sx={styles.title}>
            {category}
          </Typography>
          {isLoading ? (
            <CircularProgress size={20} />
          ) : (
            <Tooltip title="Reload">
              <IconButtonAny
                variant="elitea"
                color="tertiary"
                onClick={() => onRefresh?.(category)}
              >
                <RefreshIcon />
              </IconButtonAny>
            </Tooltip>
          )}
        </Box>
        <Box sx={{ display: 'grid', width: '100%', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
          {visibleItems
            .filter(item => !!item)
            .map(item => (
              <AgentCard
                key={category + item.id}
                application={item}
                onSelectItem={onSelectItem}
              />
            ))}
          {isLoadingMore &&
            Array.from(
              { length: Math.min(INITIAL_DISPLAY_COUNT, Math.max(0, totalCount - items.length)) },
            ).map((_, i) => (
              <Skeleton key={`skeleton-${i}`} variant="rounded" sx={styles.skeleton} />
            ))}
        </Box>
        {shouldShowButton && (
          <Box sx={styles.showMoreContainer}>
            <Typography
              variant="labelMedium"
              onClick={isExpanded ? handleShowLess : handleShowMore}
              sx={styles.showMore}
            >
              {isExpanded ? 'Show less' : 'Show more'}
            </Typography>
          </Box>
        )}
      </Box>
    );
  },
);

AgentCategorySection.displayName = 'AgentCategorySection';

const styles: Record<string, SxProps<Theme>> = {
  container: {
    width: '100%',
    maxWidth: '81.375rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  title: {
    color: 'text.secondary',
  },
  grid: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '1rem',
  },
  skeleton: {
    width: '100%',
    height: '7.25rem',
  },
  showMoreContainer: {
    display: 'flex',
    justifyContent: 'flex-end',
    height: '1.5rem',
  },
  showMore: {
    cursor: 'pointer',
    color: 'primary.main',
    '&:hover': { color: 'text.button.showMore' },
  },
};

export default AgentCategorySection;
