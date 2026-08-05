import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { useNavigate } from '@tanstack/react-router';

import { t } from '@/shared/i18n';

import { useOwnerApplications } from '../api/useOwnerApplications';
import { applicationsEmptyMessage } from '../lib/empty-copy';
import { mapApplicationToListItem } from '../lib/map-application';

import { EntityListPanel } from './EntityListPanel';
import { UnavailablePanel } from './UnavailablePanel';

export interface ApplicationsPanelProps {
  readonly projectId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly statuses: readonly string[];
  readonly forPipeline: boolean;
  readonly isPublicProject: boolean;
  readonly enabled: boolean;
}

/**
 * ROUTE-041's Applications and Pipelines tab content — same component for
 * both (`forPipeline` selects the `agents_type` filter), mirroring the
 * baseline's own `ApplicationsList` (`apps/elitea-ui/src/pages/UserPublic/ApplicationsList.jsx`),
 * which is shared the same way (`forPipeline = false` default).
 *
 * `isPublicProject` (viewMode) branches to `UnavailablePanel`: see that
 * component's doc for why the public-catalog response shape cannot support
 * this page's core "one author's items" purpose.
 *
 * `onSelect`'s target route (A12-ui adversarial-review fix — see
 * `EntityListPanel`'s doc for why the navigation decision lives in this
 * composing panel, not in that presentational component) is picked from
 * `forPipeline` alone, not `item.kind`: this panel is mounted once per tab
 * with a single, already-known entity domain (unlike `AllStuffPanel`'s
 * merged list), so every item it renders is that same kind. Literal `to`
 * strings, verified against `src/routes/_shell/user-public/agents.$agentId.tsx`
 * / `pipelines.$agentId.tsx` (ROUTE-042/043) — see `AllStuffPanel.tsx`'s
 * `navigateToEntity` doc for the full "why not import `src/routes/**`"
 * rationale, which applies identically here.
 */
export function ApplicationsPanel({
  projectId,
  authorId,
  authorName,
  statuses,
  forPipeline,
  isPublicProject,
  enabled,
}: ApplicationsPanelProps): ReactNode {
  const navigate = useNavigate();
  const { items, isLoading, isError } = useOwnerApplications({
    projectId,
    authorId,
    statuses,
    forPipeline,
    enabled: enabled && !isPublicProject,
  });

  const mapped = useMemo(() => items.map((application) => mapApplicationToListItem(application)), [items]);

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
      isLoading={isLoading}
      isError={isError}
      emptyTitle={applicationsEmptyMessage(false, authorName, forPipeline)}
      errorMessage={t('userPublic.loadError', 'Something went wrong loading this list.')}
      loadingMessage={t('userPublic.loading', 'Loading…')}
      onSelect={(item) => {
        if (forPipeline) {
          void navigate({ to: '/user-public/pipelines/$agentId', params: { agentId: item.id } });
        } else {
          void navigate({ to: '/user-public/agents/$agentId', params: { agentId: item.id } });
        }
      }}
    />
  );
}
