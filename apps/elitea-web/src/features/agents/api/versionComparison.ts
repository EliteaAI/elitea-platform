import { useQuery } from '@tanstack/react-query';

import { getApplicationVersionDetail } from '@/shared/api/generated/applications/applications';
import type { ApplicationVersionDetail } from '@/shared/api/generated/model';

/**
 * The two version reads the compare-versions modal makes.
 *
 * Both go through the SAME generated operation
 * (`getApplicationVersionDetail`, `GET /elitea_core/version/prompt_lib/
 * {projectId}/{applicationId}/{versionId}`) that already backs the editor's
 * own version switch — no new endpoint, no manifest entry, nothing added to
 * `api/openapi/v2.yaml`. The only thing this file adds is a query per side,
 * keyed so switching the right-hand version does not evict the left one.
 *
 * `eliteaFetch` returns the ENVELOPE, not the body (`shared/api/generated/
 * mutator.ts`; the #132 class of bug is reading `.instructions` straight off
 * it and getting `undefined` on a 200) — `.data` below is that unwrap, done
 * once here so no caller repeats it.
 */

const versionComparisonQueryKeys = {
  detail: (projectId: string, applicationId: number, versionId: number) =>
    ['agents', 'versionComparison', projectId, applicationId, versionId] as const,
};

async function fetchVersionDetail(
  projectId: string,
  applicationId: number,
  versionId: number,
  signal?: AbortSignal,
): Promise<ApplicationVersionDetail> {
  const response = await getApplicationVersionDetail(projectId, applicationId, versionId, signal ? { signal } : {});
  return response.data as ApplicationVersionDetail;
}

export interface UseVersionDetailOptions {
  readonly projectId: string | undefined;
  readonly applicationId: number;
  readonly versionId: number | undefined;
  readonly enabled: boolean;
}

export function useVersionDetail(options: UseVersionDetailOptions) {
  const { projectId, applicationId, versionId, enabled } = options;
  return useQuery({
    queryKey: versionComparisonQueryKeys.detail(projectId ?? '', applicationId, versionId ?? 0),
    queryFn: ({ signal }) => fetchVersionDetail(projectId ?? '', applicationId, versionId ?? 0, signal),
    enabled: enabled && projectId !== undefined && projectId !== '' && versionId !== undefined,
  });
}
