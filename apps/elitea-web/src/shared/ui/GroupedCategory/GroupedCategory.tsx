import { Fragment, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { CategoryItem } from '../CategoryItemCard';
import { t } from '@/shared/i18n';

const DEFAULT_LOADING_SKELETON_COUNT = 25;

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface GroupedCategoryProps {
  isLoading?: boolean;
  allCategories?: readonly string[];
  /** Currently-active filter selection; only used to decide `allowEmptyCategory`'s "nothing filtered yet" case. */
  selectedCategories?: readonly string[];
  groupedItems?: Readonly<Record<string, readonly CategoryItem[]>>;
  /** Render every category (even ones with 0 items) while no filter is active. */
  allowEmptyCategory?: boolean;
  renderCategory: (category: string, items: readonly CategoryItem[]) => ReactNode;
  /** Rendered when nothing matches (pass a `NoResultsMessage`, for instance). */
  noResultsSlot?: ReactNode;
  loadingSkeletonCount?: number;
  sx?: SxProps<Theme>;
  'data-testid'?: string;
}

function LoadingSkeleton({ count }: { count: number }): ReactNode {
  return (
    <Box
      component="output"
      aria-label={t('shared.ui.groupedCategory.loading', 'Loading categories')}
      sx={(theme: Theme) => ({ display: 'flex', flexWrap: 'wrap', gap: theme.spacing(1) })}
    >
      {Array.from({ length: count }, (_, index) => (
        <Box
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          aria-hidden="true"
          sx={(theme: Theme) => ({
            width: '12.75rem',
            height: '2.5rem',
            flexShrink: 0,
            flexGrow: 0,
            backgroundColor: theme.vars.palette.background.secondary,
            borderRadius: theme.vars.shape.radiusMd,
            animation: 'elGroupedCategoryPulse 1.5s ease-in-out infinite',
            '@keyframes elGroupedCategoryPulse': {
              '0%': { opacity: 1 },
              '50%': { opacity: 0.5 },
              '100%': { opacity: 1 },
            },
          })}
        />
      ))}
    </Box>
  );
}

/**
 * Renders a set of categories (each delegated to `renderCategory`, e.g.
 * `CategorySection`), a loading skeleton, or a no-results slot. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/category/GroupedCategory.jsx`.
 *
 * Deviations from the baseline:
 *  - The baseline always wraps its content in `Filter.CategoryFilter` (the
 *    title/search-box/category-chips chrome) — a `shared/ui` component
 *    outside this port's scope that does not exist in this app yet.
 *    Hard-importing it would also be the wrong fix even once it exists: it
 *    tightly couples "group items by category" to one specific filter
 *    chrome, and made `GroupedCategory` untestable without also mocking
 *    `CategoryFilter`. This port drops the import and renders only the
 *    grouped-items region; a caller composes it *inside* `CategoryFilter`'s
 *    `children` slot (or any other chrome) via normal composition —
 *    `<CategoryFilter>…><GroupedCategory .../></CategoryFilter>` — instead
 *    of `GroupedCategory` reaching up to render its own container.
 *  - The baseline decides "no results" from `Object.keys(groupedItems).length
 *    > 0`. That is `true` even when every key's array is empty (e.g.
 *    `{ Tools: [] }` with `allowEmptyCategory` off), which then falls into
 *    the `renderCategory` branch, filters every category out, and renders
 *    an empty list — a silent blank area instead of the no-results message.
 *    This port decides "no results" from whether the *actually rendered*
 *    category list ends up empty, so that gap can't occur.
 *  - `renderCategory` is required (the baseline made it optional and
 *    rendered nothing at all — silently — when it was missing, which for a
 *    component whose only job is calling it is a footgun, not a feature).
 */
export function GroupedCategory({
  isLoading = false,
  allCategories = [],
  selectedCategories = [],
  groupedItems = {},
  allowEmptyCategory = false,
  renderCategory,
  noResultsSlot,
  loadingSkeletonCount = DEFAULT_LOADING_SKELETON_COUNT,
  sx,
  'data-testid': dataTestId,
}: GroupedCategoryProps): ReactNode {
  const categoriesToRender = allCategories.filter((category) => {
    const items = groupedItems[category] ?? [];
    return (allowEmptyCategory && selectedCategories.length === 0) || items.length > 0;
  });

  return (
    <Box
      sx={sx}
      data-testid={dataTestId}
    >
      {isLoading ? (
        <LoadingSkeleton count={loadingSkeletonCount} />
      ) : categoriesToRender.length > 0 ? (
        categoriesToRender.map((category) => (
          <Fragment key={category}>{renderCategory(category, groupedItems[category] ?? [])}</Fragment>
        ))
      ) : (
        (noResultsSlot ?? null)
      )}
    </Box>
  );
}
