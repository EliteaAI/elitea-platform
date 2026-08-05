import type { ReactNode } from 'react';

import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';
import { t } from '@/shared/i18n';

/**
 * A disclosed, real UI state — NOT a TODO stub — for the two branches of
 * ROUTE-041 this unit could not wire to a real data source (see the A12
 * report for full detail on each):
 *
 *  - The Toolkits and MCPs tabs: the only generated "toolkit list" endpoint
 *    (`useListToolkits`, `GET /elitea_core/toolkits/prompt_lib/{projectId}`)
 *    is documented, by its own generator comment, as returning
 *    `ListTypeSchemas` — a map of toolkit-type NAMES to JSON-Schema
 *    descriptors, not a list of a project's configured toolkit/MCP
 *    INSTANCES. No instance-listing endpoint exists in
 *    `src/shared/api/generated/**` for this domain.
 *  - The Applications/Pipelines tabs in the "Public" viewMode (viewing an
 *    author's profile while the current project IS the public project):
 *    the generated `PublicApplicationSummary` response shape
 *    (`src/shared/api/generated/model/publicApplicationSummary.zod.ts`)
 *    carries no author/owner field at all, so there is no way to filter the
 *    public catalog down to one author's items.
 */
export interface UnavailablePanelProps {
  readonly reason: string;
}

export function UnavailablePanel({ reason }: UnavailablePanelProps): ReactNode {
  return (
    <NoResultsMessage
      title={t('userPublic.unavailableTitle', 'This list is not available yet.')}
      description={reason}
    />
  );
}
