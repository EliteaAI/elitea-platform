import { useCallback, useMemo } from 'react';

import { useNavigate, useRouteContext, useSearch } from '@tanstack/react-router';

import { toggleTagName } from './lib/railTags';

/**
 * The two pieces of router state every rail caller needs, kept here so the
 * four list pages do not each grow their own copy.
 *
 * **`tags[]` is already a registered, shell-wide search param** —
 * `src/routes/-search/params.ts:200` declares it and
 * `src/routes/-search/common.ts` mounts it on `_shell/route.tsx`, so every
 * shell-wrapped route (agents, pipelines, skills, user-public, toolkits…)
 * already validates and preserves it. No route file needed changing to make
 * the rail's tag selection real; a page that filters by tags reads the same
 * param straight off its own `useSearch`.
 *
 * This is the baseline's own contract: `hooks/useTags.jsx`'s
 * `navigateWithTags` writes the selection into the URL and `Categories.jsx`
 * reads it back, so a filtered list is linkable and survives a reload.
 */
export interface RailTagSelection {
  readonly selectedTags: readonly string[];
  readonly toggleTag: (name: string) => void;
  readonly clearTags: () => void;
}

interface TagsSearch {
  readonly 'tags[]'?: readonly string[];
}

/** Reads `tags[]` off the current route's search and writes it back on change. */
export function useRailTagSelection(): RailTagSelection {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as TagsSearch;
  const selectedTags = useMemo(() => search['tags[]'] ?? [], [search]);

  const write = useCallback(
    (next: readonly string[]) => {
      void navigate({ to: '.', search: (prev) => ({ ...prev, 'tags[]': [...next] }) });
    },
    [navigate],
  );

  const toggleTag = useCallback(
    (name: string) => {
      write(toggleTagName(selectedTags, name));
    },
    [selectedTags, write],
  );

  const clearTags = useCallback(() => {
    write([]);
  }, [write]);

  return { selectedTags, toggleTag, clearTags };
}

/**
 * The viewer's own identity, read from the router context the app installs
 * (`src/app/router-context.ts`'s `AuthContext`) — structurally, not by
 * importing that module: `app/` is the top layer and `shared/` may not
 * import it (R-L1). Same structural-read pattern
 * `pages/agents/lib/useSelectedProjectId.ts` already uses for the sibling
 * `getSelectedProjectId()` accessor.
 *
 * `authorId` is the baseline's `useQueryTrendingAuthor` fallback chain
 * (`hooks/useQueryTrendingAuthor.js:16-20`: `getAuthorDetail(authorId ||
 * userId)`) minus the URL half — a caller that has an `author_id` search
 * param (user-public does) passes it in as `authorIdFromUrl`.
 */
export interface RailViewer {
  /** `GetAuthorDetail` takes a numeric id; a non-numeric or absent user id resolves to `undefined` (query disabled) rather than to `0` (a request for author 0). */
  readonly authorId: number | undefined;
  readonly personalProjectId: string | undefined;
}

interface RailAuthContext {
  readonly auth?: {
    readonly getUser?: () => { readonly id?: string; readonly personal_project_id?: string } | undefined;
  };
}

/** Pure extraction, unit-tested without a router. */
export function selectRailViewer(context: unknown, authorIdFromUrl?: string): RailViewer {
  const typed = typeof context === 'object' && context !== null ? (context as RailAuthContext) : undefined;
  const user = typed?.auth?.getUser?.();
  const rawId = authorIdFromUrl ?? user?.id;
  const parsed = rawId === undefined || rawId === '' ? Number.NaN : Number(rawId);
  return {
    authorId: Number.isFinite(parsed) ? parsed : undefined,
    personalProjectId: user?.personal_project_id,
  };
}

export function useRailViewer(authorIdFromUrl?: string): RailViewer {
  const context: unknown = useRouteContext({ strict: false });
  return selectRailViewer(context, authorIdFromUrl);
}
