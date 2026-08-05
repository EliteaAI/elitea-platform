/**
 * The 'idle'-phase half of `useSlashCommandHandler.hooks.js`'s
 * `syncWithValue` dispatch (`useSlashCommandHandler.hooks.js:325-350`,
 * "Four strategies to re-enter toolkit/tool phase from idle"), ported
 * function-for-function into a `SlashHandlerContext`-threaded form — see
 * `useSlashCommandHandler.types.ts`'s doc comment for why this hook is
 * split across files.
 */
import { toolkitFromMention, uncommitMention } from './useSlashCommandHandler.helpers';
import type { CommittedToolkitMention, SlashFullMatch, SlashHandlerContext, SlashToolkitOnlyMatch } from './useSlashCommandHandler.types';

/** Handles `/toolkitName/toolQuery` — re-enters 'tool' phase from a committed mention. `useSlashCommandHandler.hooks.js:179-201`. */
function tryReEnterToolPhaseFromMention(ctx: SlashHandlerContext, textToCursor: string, mention: CommittedToolkitMention): boolean {
  const fullPrefix = '/' + mention.toolkitName + '/';
  const prefixIdx = textToCursor.lastIndexOf(fullPrefix);
  if (prefixIdx === -1) return false;

  const toolQueryPart = textToCursor.slice(prefixIdx + fullPrefix.length);
  if (/[\s/]/.test(toolQueryPart)) return false;

  const toolkit = toolkitFromMention(mention);
  uncommitMention(ctx, mention.toolkitId, mention.projectId);
  ctx.setters.setSelectedToolkit(toolkit);
  ctx.refs.lastToolkit = toolkit;
  ctx.setters.setToolkitQuery(mention.toolkitName);
  ctx.setters.setToolQuery(toolQueryPart);
  ctx.refs.phaseCurrent = 'tool';
  ctx.setters.setPhase('tool');
  ctx.setters.setIsQueryFinal(false);
  if (ctx.refs.mentionAnchor === null) ctx.refs.mentionAnchor = prefixIdx;
  return true;
}

/** Handles `/toolkitName` (no separator) — re-enters 'toolkit' phase from a committed mention. `useSlashCommandHandler.hooks.js:207-224`. */
function tryReEnterToolkitPhaseFromMention(ctx: SlashHandlerContext, textToCursor: string, mention: CommittedToolkitMention): boolean {
  const nameOnly = '/' + mention.toolkitName;
  const nameIdx = textToCursor.lastIndexOf(nameOnly);
  if (nameIdx === -1) return false;
  if (!/^[^\s/]*$/.test(textToCursor.slice(nameIdx + nameOnly.length))) return false;

  uncommitMention(ctx, mention.toolkitId, mention.projectId);
  ctx.refs.lastToolkit = toolkitFromMention(mention);
  ctx.setters.setToolkitQuery(mention.toolkitName);
  ctx.refs.phaseCurrent = 'toolkit';
  ctx.setters.setPhase('toolkit');
  ctx.setters.setIsQueryFinal(false);
  if (ctx.refs.mentionAnchor === null) ctx.refs.mentionAnchor = nameIdx;
  return true;
}

/** The regex full-match path (`/toolkitName/toolQuery`) when no committed mention loop matched — resolves via committed mention, `lastToolkitRef`, or unknown. `useSlashCommandHandler.hooks.js:230-269`. */
function syncIdleHandleFullMatch(ctx: SlashHandlerContext, textToCursor: string, cursorPos: number | null | undefined, fullMatch: SlashFullMatch): void {
  const detectedName = fullMatch.toolkitName.toLowerCase();
  const committedMatch = ctx.refs.committedMentions.find((m) => m.toolkitName.toLowerCase() === detectedName);

  if (committedMatch) {
    const toolkit = toolkitFromMention(committedMatch);
    uncommitMention(ctx, committedMatch.toolkitId, committedMatch.projectId);
    ctx.setters.setSelectedToolkit(toolkit);
    ctx.refs.lastToolkit = toolkit;
    ctx.setters.setToolkitQuery(fullMatch.toolkitName);
    ctx.setters.setToolQuery(fullMatch.toolQuery);
    ctx.refs.phaseCurrent = 'tool';
    ctx.setters.setPhase('tool');
    ctx.setters.setIsQueryFinal(false);
  } else if (ctx.refs.lastToolkit && ctx.refs.lastToolkit.name.toLowerCase() === detectedName) {
    // Fallback to lastToolkitRef (handles paste/backspace for most-recent toolkit).
    ctx.setters.setSelectedToolkit(ctx.refs.lastToolkit);
    ctx.setters.setToolkitQuery(fullMatch.toolkitName);
    ctx.setters.setToolQuery(fullMatch.toolQuery);
    ctx.refs.phaseCurrent = 'tool';
    ctx.setters.setPhase('tool');
    ctx.setters.setIsQueryFinal(false);
  } else {
    // Unknown toolkit name — enter toolkit phase; auto-select will resolve it.
    ctx.refs.pendingToolQuery = fullMatch.toolQuery;
    ctx.setters.setToolkitQuery(fullMatch.toolkitName);
    ctx.refs.phaseCurrent = 'toolkit';
    ctx.setters.setPhase('toolkit');
    ctx.setters.setIsQueryFinal(true);
  }

  if (ctx.refs.mentionAnchor === null) {
    ctx.refs.mentionAnchor = (cursorPos ?? textToCursor.length) - fullMatch.raw.length;
  }
}

/** The regex toolkit-only match (`/toolkitName`, no separator) — covers backspace/paste; normal `/` keypress is handled by `onKeyDown`. `useSlashCommandHandler.hooks.js:275-283`. */
function syncIdleHandleToolkitOnlyMatch(ctx: SlashHandlerContext, textToCursor: string, cursorPos: number | null | undefined, toolkitOnlyMatch: SlashToolkitOnlyMatch): void {
  ctx.setters.setToolkitQuery(toolkitOnlyMatch.toolkitName);
  ctx.refs.phaseCurrent = 'toolkit';
  ctx.setters.setPhase('toolkit');
  ctx.setters.setIsQueryFinal(false);
  if (ctx.refs.mentionAnchor === null) {
    ctx.refs.mentionAnchor = (cursorPos ?? textToCursor.length) - toolkitOnlyMatch.raw.length;
  }
}

/** Last-resort fallback for space-containing toolkit names being partially backspaced. `useSlashCommandHandler.hooks.js:289-323`. */
function syncIdleHandleLastSlashFallback(ctx: SlashHandlerContext, textToCursor: string): void {
  const lastSlashIdx = textToCursor.lastIndexOf('/');
  if (lastSlashIdx === -1) return;

  const afterSlash = textToCursor.slice(lastSlashIdx + 1);
  if (afterSlash.length === 0 || afterSlash.endsWith(' ')) return;

  for (const mention of ctx.refs.committedMentions) {
    if (mention.toolkitName.toLowerCase().startsWith(afterSlash.toLowerCase())) {
      uncommitMention(ctx, mention.toolkitId, mention.projectId);
      ctx.refs.lastToolkit = toolkitFromMention(mention);
      ctx.setters.setToolkitQuery(afterSlash);
      ctx.refs.phaseCurrent = 'toolkit';
      ctx.setters.setPhase('toolkit');
      ctx.setters.setIsQueryFinal(false);
      if (ctx.refs.mentionAnchor === null) ctx.refs.mentionAnchor = lastSlashIdx;
      return;
    }
  }

  // Committed mention already removed — fall back to lastToolkitRef.
  if (ctx.refs.lastToolkit && ctx.refs.lastToolkit.name.toLowerCase().startsWith(afterSlash.toLowerCase())) {
    ctx.setters.setToolkitQuery(afterSlash);
    ctx.refs.phaseCurrent = 'toolkit';
    ctx.setters.setPhase('toolkit');
    ctx.setters.setIsQueryFinal(false);
    if (ctx.refs.mentionAnchor === null) ctx.refs.mentionAnchor = lastSlashIdx;
  }
}

/**
 * `useSlashCommandHandler.hooks.js:332-350`'s `syncIdlePhase` — four
 * strategies to re-enter toolkit/tool phase from idle:
 *   1. Committed-mention literal prefix loop (handles space-containing names)
 *   2. Regex full match: /toolkitName/toolQuery
 *   3. Regex toolkit-only match: /toolkitName
 *   4. lastSlashIdx fallback (space-containing names partially backspaced)
 */
export function syncIdlePhase(
  ctx: SlashHandlerContext,
  textToCursor: string,
  cursorPos: number | null | undefined,
  fullMatch: SlashFullMatch | null,
  toolkitOnlyMatch: SlashToolkitOnlyMatch | null,
): void {
  for (const mention of ctx.refs.committedMentions) {
    if (tryReEnterToolPhaseFromMention(ctx, textToCursor, mention)) return;
    if (tryReEnterToolkitPhaseFromMention(ctx, textToCursor, mention)) return;
  }

  if (fullMatch) {
    syncIdleHandleFullMatch(ctx, textToCursor, cursorPos, fullMatch);
    return;
  }
  if (toolkitOnlyMatch) {
    syncIdleHandleToolkitOnlyMatch(ctx, textToCursor, cursorPos, toolkitOnlyMatch);
    return;
  }
  syncIdleHandleLastSlashFallback(ctx, textToCursor);
}
