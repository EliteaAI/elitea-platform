/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useSlashHighlights.hooks.js`, field names updated to this port's
 * camelCase `CommittedToolkitMention` (`m.toolkitName`/`m.toolName`
 * instead of the baseline's `m.toolkit_name`/`m.tool_name` — see
 * `useSlashCommandHandler.types.ts`'s header for the full rationale).
 *
 * **Internal implementation detail of `useSlashMention` — not exported
 * from this slice's public `index.ts` barrel**, same rationale as
 * `useSlashCommandHandler.ts`'s own doc comment (the baseline's only real
 * caller is `useSlashMention.hooks.js`).
 */
import { useMemo } from 'react';

import type { MentionRange } from '../utils/instructionsMention.utils';
import type { CommittedToolkitMention } from './useSlashCommandHandler.types';

/**
 * Computes highlight ranges for committed slash mentions within the current input text.
 *
 * Returns an array of {start, end} character positions (sorted, non-overlapping)
 * for every committed mention token found in the input.
 *
 * Longer tokens are checked first so that `/toolkit/tool` shadows `/toolkit`
 * when both appear at the same position.
 */
export function useSlashHighlights(inputContent: string, committedMentions: readonly CommittedToolkitMention[]): readonly MentionRange[] {
  return useMemo(() => {
    if (!committedMentions.length || !inputContent) return [];

    // Build unique token strings; sort longest-first to prevent sub-match shadowing.
    const tokens = [
      ...new Set(committedMentions.map((m) => (m.toolName ? `/${m.toolkitName}/${m.toolName}` : `/${m.toolkitName}`))),
    ].sort((a, b) => b.length - a.length);

    const ranges: MentionRange[] = [];

    for (const token of tokens) {
      let idx = inputContent.indexOf(token);
      while (idx !== -1) {
        const end = idx + token.length;
        // Skip if this range overlaps any already-recorded range.
        if (!ranges.some((r) => idx < r.end && end > r.start)) {
          ranges.push({ start: idx, end });
        }
        idx = inputContent.indexOf(token, idx + 1);
      }
    }

    return ranges.sort((a, b) => a.start - b.start);
  }, [inputContent, committedMentions]);
}
