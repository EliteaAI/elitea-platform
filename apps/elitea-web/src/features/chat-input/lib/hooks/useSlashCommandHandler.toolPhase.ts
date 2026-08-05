/**
 * The 'toolkit'- and 'tool'-phase halves of `useSlashCommandHandler.hooks.js`'s
 * `syncWithValue` dispatch, ported function-for-function into a
 * `SlashHandlerContext`-threaded form — see
 * `useSlashCommandHandler.types.ts`'s doc comment for why this hook is
 * split across files.
 */
import { mergeCommittedMention, resetSlash } from './useSlashCommandHandler.helpers';
import type { SlashFullMatch, SlashHandlerContext, SlashToolkitOnlyMatch, SlashToolkitRef } from './useSlashCommandHandler.types';

/**
 * Before dismissing back to 'idle', checks whether the partial text still
 * prefixes a committed mention or the last-selected toolkit (handles
 * space-containing names the regex can't detect). Returns `true` if the
 * toolkit query was kept (re-armed) instead of dismissed.
 * `useSlashCommandHandler.hooks.js:365-386`.
 */
function keepPartialToolkitQuery(ctx: SlashHandlerContext, textToCursor: string): boolean {
  if (ctx.refs.mentionAnchor === null) return false;
  const fragment = textToCursor.slice(ctx.refs.mentionAnchor);
  if (!fragment.startsWith('/') || fragment.length <= 1) return false;

  const afterSlash = fragment.slice(1);
  if (afterSlash.includes('/') || afterSlash.endsWith(' ')) return false;

  const partialCommit = ctx.refs.committedMentions.find((m) => m.toolkitName.toLowerCase().startsWith(afterSlash.toLowerCase()));
  const partialLast = ctx.refs.lastToolkit !== null && ctx.refs.lastToolkit.name.toLowerCase().startsWith(afterSlash.toLowerCase());
  if (!partialCommit && !partialLast) return false;

  ctx.setters.setToolkitQuery(afterSlash);
  ctx.setters.setIsQueryFinal(false);
  return true;
}

/** `useSlashCommandHandler.hooks.js:353-397`'s `syncToolkitPhase`. */
export function syncToolkitPhase(
  ctx: SlashHandlerContext,
  textToCursor: string,
  cursorPos: number | null | undefined,
  fullMatch: SlashFullMatch | null,
  toolkitOnlyMatch: SlashToolkitOnlyMatch | null,
): void {
  if (fullMatch) {
    // Second slash appeared (typed or pasted) — toolkit name is final.
    ctx.refs.pendingToolQuery = fullMatch.toolQuery;
    ctx.setters.setToolkitQuery(fullMatch.toolkitName);
    ctx.setters.setIsQueryFinal(true);
  } else if (toolkitOnlyMatch) {
    // Toolkit name is still being typed.
    ctx.setters.setToolkitQuery(toolkitOnlyMatch.toolkitName);
    ctx.setters.setIsQueryFinal(false);
  } else if (!keepPartialToolkitQuery(ctx, textToCursor)) {
    resetSlash(ctx);
  }

  // Set anchor on the first syncWithValue call in toolkit phase (covers fresh
  // '/' pressed — onKeyDown enters toolkit but doesn't set anchor).
  const match = fullMatch ?? toolkitOnlyMatch;
  if (ctx.refs.mentionAnchor === null && match) {
    ctx.refs.mentionAnchor = (cursorPos ?? textToCursor.length) - match.raw.length;
  }
}

/** Commits the toolkit-only mention (separator just deleted) and returns to idle. `useSlashCommandHandler.hooks.js:427-443`. */
function commitToolkitOnlyAndReset(ctx: SlashHandlerContext, selectedToolkit: SlashToolkitRef): void {
  ctx.setters.setCommittedMentions((prev) =>
    mergeCommittedMention(prev, {
      toolkitId: selectedToolkit.id,
      projectId: selectedToolkit.projectId,
      toolkitName: selectedToolkit.name,
      toolkitType: selectedToolkit.type,
      ...(selectedToolkit.settings !== undefined ? { toolkitSettings: selectedToolkit.settings } : {}),
      toolName: null,
    }),
  );
  resetSlash(ctx);
}

/** Backspacing through a space-containing toolkit name — re-enters 'toolkit' phase if the partial fragment still prefixes `selectedToolkit.name`. Returns `true` if re-entered. `useSlashCommandHandler.hooks.js:445-472`. */
function tryReEnterToolkitPhaseFromPartialName(ctx: SlashHandlerContext, textToCursor: string, selectedToolkit: SlashToolkitRef): boolean {
  if (ctx.refs.mentionAnchor === null) return false;
  const fragment = textToCursor.slice(ctx.refs.mentionAnchor);
  if (!fragment.startsWith('/') || fragment.length <= 1) return false;

  const afterSlash = fragment.slice(1);
  if (afterSlash.includes('/') || afterSlash.endsWith(' ')) return false;
  if (!selectedToolkit.name.toLowerCase().startsWith(afterSlash.toLowerCase())) return false;

  ctx.setters.setCommittedMentions((prev) => prev.filter((m) => !(m.toolkitId === selectedToolkit.id && m.projectId === selectedToolkit.projectId)));
  ctx.setters.setToolkitQuery(afterSlash);
  ctx.refs.phaseCurrent = 'toolkit';
  ctx.setters.setPhase('toolkit');
  ctx.setters.setIsQueryFinal(false);
  return true;
}

/**
 * `useSlashCommandHandler.hooks.js:400-476`'s `syncToolPhase`.
 * `selectedToolkit` is passed explicitly (rather than read off `ctx.refs`)
 * because it is React state the hook itself owns (`useState`), not one of
 * the plain mutable refs `SlashHandlerContext` bundles — mirrors the
 * baseline's own `useCallback` closing over `selectedToolkit` directly.
 */
export function syncToolPhase(ctx: SlashHandlerContext, textToCursor: string, selectedToolkit: SlashToolkitRef | null): void {
  if (!selectedToolkit) {
    resetSlash(ctx);
    return;
  }

  // Use textToCursor so editing a mention in the middle of the input is tracked
  // correctly — the tool query is the portion from the prefix end to the cursor.
  const toolkitPrefix = '/' + selectedToolkit.name + '/';
  const prefixIdx = textToCursor.lastIndexOf(toolkitPrefix);

  if (prefixIdx !== -1) {
    const toolQueryPart = textToCursor.slice(prefixIdx + toolkitPrefix.length);
    // A space or extra '/' after the prefix means the mention is finished.
    if (/[\s/]/.test(toolQueryPart)) {
      resetSlash(ctx);
    } else {
      ctx.setters.setToolQuery(toolQueryPart);
    }
    return;
  }

  // Prefix not found — check if the separator '/' was just deleted.
  const toolkitNameOnly = '/' + selectedToolkit.name;
  const nameIdx = textToCursor.lastIndexOf(toolkitNameOnly);
  const afterName = nameIdx !== -1 ? textToCursor.slice(nameIdx + toolkitNameOnly.length) : null;

  if (afterName !== null && afterName.trim() === '') {
    commitToolkitOnlyAndReset(ctx, selectedToolkit);
    return;
  }

  if (!tryReEnterToolkitPhaseFromPartialName(ctx, textToCursor, selectedToolkit)) {
    resetSlash(ctx);
  }
}
