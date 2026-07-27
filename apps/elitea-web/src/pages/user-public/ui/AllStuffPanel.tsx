import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { t } from '@/shared/i18n';

import { useOwnerApplications } from '../api/useOwnerApplications';
import { allStuffEmptyMessage } from '../lib/empty-copy';
import { mapApplicationToListItem } from '../lib/map-application';
import { mergeSortAndFilterByTags } from '../lib/merge-and-sort';

import { EntityListPanel } from './EntityListPanel';
import { UnavailablePanel } from './UnavailablePanel';

export interface AllStuffPanelProps {
  readonly projectId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly statuses: readonly string[];
  readonly isPublicProject: boolean;
  readonly enabled: boolean;
}

/**
 * ROUTE-041's "All" tab — merges applications and pipelines, newest-first
 * (parity: `AllStuffList.jsx:150-179`, see `lib/merge-and-sort.ts`).
 *
 * Toolkits and MCPs are NOT included in the merge here (the baseline's
 * `AllStuffList` also merges `useLoadToolkits` results into the same list —
 * `AllStuffList.jsx:84-133,150-166`). No instance-listing endpoint exists
 * for either domain in this app's generated client (see
 * `UnavailablePanel`'s doc) — the merged total this panel shows is
 * therefore a real but incomplete subset of the baseline's, a disclosed gap
 * (A12 report), not a silent one.
 */
export function AllStuffPanel({
  projectId,
  authorId,
  authorName,
  statuses,
  isPublicProject,
  enabled,
}: AllStuffPanelProps): ReactNode {
  const applications = useOwnerApplications({
    projectId,
    authorId,
    statuses,
    forPipeline: false,
    enabled: enabled && !isPublicProject,
  });
  const pipelines = useOwnerApplications({
    projectId,
    authorId,
    statuses,
    forPipeline: true,
    enabled: enabled && !isPublicProject,
  });

  const mapped = useMemo(() => {
    const merged = mergeSortAndFilterByTags([applications.items, pipelines.items], []);
    return merged.map((application) => mapApplicationToListItem(application));
  }, [applications.items, pipelines.items]);

  if (isPublicProject) {
    return (
      <UnavailablePanel
        reason={t(
          'userPublic.publicViewModeUnavailable',
          "The public catalog's response does not include author information, so items cannot be narrowed to one author's profile here.",
        )}
      />
    );
  }

  return (
    <EntityListPanel
      items={mapped}
      isLoading={applications.isLoading || pipelines.isLoading}
      isError={applications.isError || pipelines.isError}
      emptyTitle={allStuffEmptyMessage(false, authorName)}
      errorMessage={t('userPublic.loadError', 'Something went wrong loading this list.')}
      loadingMessage={t('userPublic.loading', 'Loading…')}
    />
  );
}
