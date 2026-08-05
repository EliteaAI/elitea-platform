/**
 * Split out of `ChatBox.tsx` to stay under the file-length budget (§3.5) —
 * the "/" toolkit-tool mention system's two injected data-query hooks.
 */
import { useMemo } from 'react';

import { useListToolkitInstances } from '@/shared/api/generated/toolkits/toolkits';
import type { ToolkitInstance } from '@/shared/api/generated/model';

/**
 * A no-op `SlashSuggestionList.useValidateToolkitQuery` injection — there is
 * no real toolkit-validation endpoint anywhere in this app yet (confirmed:
 * `entities/toolkit`'s own `useValidateToolkit.ts` module doc), so every
 * toolkit is provisionally treated as valid rather than inventing a fake
 * network call.
 */
export function useNoopValidateToolkitQuery(): { readonly isError: boolean; readonly error: unknown } {
  return { isError: false, error: undefined };
}

/**
 * `SlashSuggestionList.useToolkitDetailsQuery` injection for the "/" system's
 * 'tool' phase — there is no single-toolkit-detail endpoint either (same
 * disclosed gap `features/toolkits/api/toolkits.ts`'s own `useToolkitDetail`
 * documents), so this finds the toolkit's row inside the real
 * `useListToolkitInstances` collection client-side, matching that file's own
 * `MAX_DETAIL_LOOKUP_PAGE_SIZE`-bounded approach.
 */
const SLASH_TOOLKIT_LOOKUP_PAGE_SIZE = 200;

/** Reads the first string-typed value among `keys` off `record`, defaulting to `''` — avoids `String(unknown)`'s `no-base-to-string` risk. */
function pickStr(record: Record<string, unknown>, ...keys: readonly string[]): string {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === 'string') return v;
  }
  return '';
}

export function useSlashToolkitDetailsQuery(args: {
  readonly projectId: string | undefined;
  readonly toolkitId: string | undefined;
  readonly skip: boolean;
}): { readonly tools: readonly { readonly name: string; readonly description?: string }[]; readonly isFetching: boolean } {
  const query = useListToolkitInstances(
    args.projectId ?? '',
    { limit: SLASH_TOOLKIT_LOOKUP_PAGE_SIZE, offset: 0 },
    { query: { enabled: !args.skip && args.projectId !== undefined } },
  );
  const rows = useMemo(
    () => (query.data?.data as { rows?: readonly ToolkitInstance[] } | undefined)?.rows ?? [],
    [query.data?.data],
  );
  const detail = useMemo(() => rows.find((row) => row.id === args.toolkitId), [rows, args.toolkitId]);
  const tools = useMemo(() => {
    if (!detail) return [];
    const settings = detail.settings;
    const isMcp = detail.type === 'mcp' || detail.type.startsWith('mcp_');
    if (isMcp) {
      const list = (settings['available_mcp_tools'] as readonly Record<string, unknown>[] | undefined) ?? [];
      return list.map((item) => ({ name: pickStr(item, 'value', 'label'), description: pickStr(item, 'description') }));
    }
    const list = (settings['selected_tools'] as readonly string[] | undefined) ?? [];
    return list.map((name) => ({ name, description: '' }));
  }, [detail]);
  return { tools, isFetching: query.isFetching };
}
