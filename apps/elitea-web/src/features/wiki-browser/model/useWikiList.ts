/**
 * The wikis a project can see, and which of them belong to the configured
 * repository.
 *
 * HEADLESS. The hook returns data and state; nothing here renders. That is what
 * lets the reducer-shaped parts of this feature be tested as functions rather
 * than through a component tree.
 *
 * THE FILTER IS THE POINT, not the fetch. A bucket holds every wiki any project
 * generated, so listing objects is only the first half — `filterManifestsByRepo`
 * decides which of them this toolkit's repository owns, and its rules are what
 * stop a project seeing a neighbour's wiki. Those rules live in `entities/wiki`
 * with 35 tests over them, including the branch asymmetry the legacy suite
 * never covered.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  fetchWikiManifest,
  filterManifestsByRepo,
  listWikiObjects,
  manifestKeys,
  type RepositoryIdentity,
  type WikiManifest,
} from '@/entities/wiki';

/** The query key namespace. Kept in one place — a disjoint key is a screen that renders nothing. */
export const wikiListQueryKey = (projectId: string | number, repository: string | null) =>
  ['deepwiki', 'wiki-list', String(projectId), repository ?? ''] as const;

export interface WikiListResult {
  /** Manifests belonging to the configured repository. */
  wikis: WikiManifest[];
  /** Every manifest in the bucket, before the repository filter. */
  allWikis: WikiManifest[];
}

/**
 * Load every wiki manifest in the project's bucket, then narrow to the ones
 * belonging to `identity`.
 *
 * `allWikis` is returned alongside so a caller can tell "this project has
 * generated nothing" from "this bucket has wikis and none is yours" — the two
 * need different empty states, and collapsing them is how an empty screen stops
 * being diagnosable.
 */
export function useWikiList(
  projectId: string | number,
  identity: RepositoryIdentity | null,
  options: { enabled?: boolean } = {},
): UseQueryResult<WikiListResult> {
  return useQuery({
    queryKey: wikiListQueryKey(projectId, identity?.repository ?? null),
    enabled: options.enabled !== false,
    queryFn: async (): Promise<WikiListResult> => {
      const objects = await listWikiObjects(projectId);
      const manifests = await Promise.all(
        manifestKeys(objects).map((key) => fetchWikiManifest(projectId, key)),
      );
      const allWikis = manifests.filter((m): m is WikiManifest => Boolean(m));
      return {
        allWikis,
        wikis: identity ? filterManifestsByRepo(allWikis, identity) : [],
      };
    },
  });
}
