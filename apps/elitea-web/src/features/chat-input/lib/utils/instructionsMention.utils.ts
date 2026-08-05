/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/shared/lib/utils/instructionsMention.utils.js`
 * — `parseMentionRanges` only (byte-for-byte behaviour), plus the
 * `MentionRange`/`MentionableItem`/`MentionableTool` types and private
 * helpers it depends on (`getValidToolNames`/`resolveToolkitMentionEnd`/
 * `resolveMentionEnd`/`collectItemRanges` — split out in the baseline
 * purely to stay under this codebase's `complexity` budget; no behaviour
 * differs from a single-function port). `isToolkitItem`/`getItemDescription`
 * (dropdown-label helpers) and `createMentionCmExtension` (a CodeMirror
 * `Extension` factory) are NOT ported: `useChatSkillMention.hooks.js` (this
 * file's only real caller in this unit) imports `parseMentionRanges` alone,
 * and this feature's "~" mention renders over a plain textarea, not
 * CodeMirror (unlike the instructions editor) — see this slice's own
 * `useSlashMention`/`useSlashCommandHandler` module doc comments for the
 * fuller "plain textarea vs. CodeMirror" contrast.
 *
 * **Deliberate duplicate, not a promotion — mirrors an already-landed
 * sibling copy.** `features/agents/lib/utils/instructionsMention.utils.ts`
 * ported the SAME baseline file first (Wave-2 unit A1b), with its own doc
 * comment explicitly anticipating this exact situation: "promote to
 * `shared/lib` if a future consumer outside `features/agents` needs it."
 * This unit (`features/chat-input`, Wave-2 unit C3) IS that future
 * consumer, but `features/chat-input` may not import `features/agents`
 * (`no-sideways-features` — absolute, no exceptions for "it's just a pure
 * utility"), and promoting `features/agents`' copy to `shared/lib` as a
 * side effect of this build would touch an already-shipped unit's files,
 * out of this cluster's scope. So: a second, independent duplicate here,
 * flagged as a promotion candidate for a future cleanup pass — NOT
 * re-derived from scratch, to minimise the risk of the two copies drifting
 * behaviourally apart before that promotion happens.
 *
 * This mirrors the OLD app's own precedent for tolerating exactly this
 * kind of duplication: it built a generic `useMentionHighlights` in
 * `shared/lib/` (`apps/elitea-ui/src/[fsd]/shared/lib/hooks/
 * useMentionHighlights.hooks.js`), but its own chat feature
 * (`useSlashHighlights.hooks.js`, ported alongside this file into
 * `../hooks/useSlashHighlights.ts`) never migrated to use it, keeping a
 * parallel local implementation instead — a live, in-repo example of this
 * exact judgment call already being acceptable in the codebase this port
 * is drawn from.
 */

/**
 * A version `tools[]` entry, or a mentionable-item projection of one — just
 * the fields `getValidToolNames`/`resolveToolkitMentionEnd` read. `name` is
 * optional here (matching the baseline copy) even though every real caller
 * of `parseMentionRanges` passes items with a `name` — {@link MentionableItem}
 * narrows it back to required. Not exported beyond this module (knip: no
 * outside consumer by name — a same-named, independently-exported duplicate
 * lives at `features/agents/lib/utils/instructionsMention.utils.ts`, see
 * this file's module doc for why that's a deliberate, disclosed duplicate
 * rather than a shared import).
 */
interface MentionableTool {
  readonly name?: string | undefined;
  readonly type?: string | undefined;
  readonly agent_type?: string | undefined;
  readonly settings?:
    | {
        readonly available_mcp_tools?: readonly { readonly value?: string | undefined; readonly label?: string | undefined }[] | undefined;
        readonly selected_tools?: readonly string[] | undefined;
      }
    | undefined;
}

export interface MentionableItem extends MentionableTool {
  readonly name: string;
  readonly isToolkit?: boolean;
}

export interface MentionRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Returns the Set of valid tool names for a toolkit item, or `null` if the
 * item has no `settings` (validation not possible — all names accepted).
 * Only reachable for `item.isToolkit === true` — this unit's own skill
 * items never set that flag (see `useChatSkillMention.ts`), so this branch
 * is unexercised here but kept for byte-for-byte fidelity with the ported
 * function.
 */
function getValidToolNames(item: MentionableItem): ReadonlySet<string> | null {
  if (!item.settings) return null;
  const isMcp = item.type === 'mcp' || item.type?.startsWith('mcp_');
  if (isMcp) {
    return new Set((item.settings.available_mcp_tools ?? []).map((t) => t.value ?? t.label ?? ''));
  }
  return new Set(item.settings.selected_tools ?? []);
}

/** The toolkit-with-separator branch of `resolveMentionEnd` — `/Name/ToolName` or `/Name#ToolName`. */
function resolveToolkitMentionEnd(item: MentionableItem, pos: number, baseToken: string, after: string): number | undefined {
  const toolMatch = /^([^\s/#]+)/.exec(after.slice(1));
  if (toolMatch?.[1] === undefined) {
    // Separator present but no tool name — highlight the toolkit name only.
    return pos + baseToken.length;
  }
  const toolName = toolMatch[1];
  const validToolNames = getValidToolNames(item);
  // Only extend highlight to the tool name if it is a valid tool in this toolkit; otherwise skip
  // this occurrence entirely (no highlight) — matches the baseline's own comment/behaviour.
  return !validToolNames || validToolNames.has(toolName) ? pos + baseToken.length + 1 + toolName.length : undefined;
}

/** Computes the highlight end offset for one occurrence of `item`'s token at `pos`, or `undefined` if this occurrence should not be highlighted. Extracted from `parseMentionRanges` purely to keep that function's own `complexity` under this codebase's gate. */
function resolveMentionEnd(item: MentionableItem, pos: number, baseToken: string, text: string): number | undefined {
  const after = text.slice(pos + baseToken.length);
  if (item.isToolkit && (after.startsWith('/') || after.startsWith('#'))) {
    return resolveToolkitMentionEnd(item, pos, baseToken, after);
  }
  if (after === '' || (after[0] !== undefined && /[\s/#]/.test(after[0]))) {
    return pos + baseToken.length;
  }
  return undefined;
}

function collectItemRanges(item: MentionableItem, text: string, triggerChar: string, ranges: MentionRange[]): void {
  const baseToken = triggerChar + item.name;
  let pos = text.indexOf(baseToken);
  while (pos !== -1) {
    const prevChar = pos > 0 ? text[pos - 1] : '';
    if (prevChar === '' || (prevChar !== undefined && /\s/.test(prevChar))) {
      const end = resolveMentionEnd(item, pos, baseToken, text);
      if (end !== undefined && !ranges.some((r) => pos < r.end && end > r.start)) {
        ranges.push({ start: pos, end });
      }
    }
    pos = text.indexOf(baseToken, pos + 1);
  }
}

/**
 * Scans `text` for mention tokens matching entries in `mentionableItems`.
 * Handles both '/' and '#' as the toolkit/tool separator for backwards
 * compatibility. A leading trigger char must be preceded by start-of-text or
 * whitespace. Ported line-for-line from the baseline (split across this
 * function and `resolveMentionEnd`/`resolveToolkitMentionEnd`/
 * `collectItemRanges` purely to keep every function under this codebase's
 * `complexity` gate — no behaviour differs from a single-function port).
 */
export function parseMentionRanges(
  text: string,
  mentionableItems: readonly MentionableItem[] | undefined,
  triggerChar = '/',
): readonly MentionRange[] {
  if (!text || !mentionableItems?.length) return [];

  const ranges: MentionRange[] = [];
  // Longest name first so a shorter prefix does not shadow a longer name at the same position.
  const sortedItems = [...mentionableItems].sort((a, b) => b.name.length - a.name.length);

  for (const item of sortedItems) {
    collectItemRanges(item, text, triggerChar, ranges);
  }

  return ranges.sort((a, b) => a.start - b.start);
}
