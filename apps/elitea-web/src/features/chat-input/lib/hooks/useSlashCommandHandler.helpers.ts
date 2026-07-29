import type { KeyboardEvent } from 'react';

import type { CommittedToolkitMention, SlashFullMatch, SlashHandlerContext, SlashToolkitOnlyMatch, SlashToolkitRef } from './useSlashCommandHandler.types';

function isNextItemKey(key: string): boolean {
  return key === 'ArrowDown' || key === 'PageDown' || key === 'ArrowRight';
}

function isPrevItemKey(key: string): boolean {
  return key === 'ArrowUp' || key === 'PageUp' || key === 'ArrowLeft';
}

/**
 * `useSlashCommandHandler.hooks.js:113-140`'s "dropdown keyboard
 * navigation (active when suggestion list is visible)" block, extracted
 * into its own function purely to keep `onKeyDown` itself under this
 * codebase's `complexity` budget (12) — no behaviour differs from the
 * inlined original. Returns `true` if the event was handled (caller should
 * stop further processing), `false` otherwise.
 */
export function handleDropdownKeyDown(
  event: KeyboardEvent,
  itemCount: number,
  activeIndexCurrent: number,
  setActiveIndex: (index: number) => void,
  onConfirmActiveRef: { current: ((index: number) => void) | null },
): boolean {
  const { key } = event;

  if (isNextItemKey(key)) {
    event.preventDefault();
    if (itemCount > 0) {
      setActiveIndex(activeIndexCurrent < itemCount - 1 ? activeIndexCurrent + 1 : activeIndexCurrent);
    }
    return true;
  }

  if (isPrevItemKey(key)) {
    event.preventDefault();
    setActiveIndex(activeIndexCurrent > 0 ? activeIndexCurrent - 1 : 0);
    return true;
  }

  if (key === 'Enter' && activeIndexCurrent >= 0) {
    event.preventDefault();
    onConfirmActiveRef.current?.(activeIndexCurrent);
    return true;
  }

  return false;
}

/** `/\/([^/\s]+)\/([^/\s]*)$/` against `text.slice(0, cursorPos)` — matches `/toolkitName/toolQuery` (`toolQuery` may be empty). Also matches a bare `"/"` (empty name), intentionally keeping the dropdown visible right after the slash is typed — the baseline's own documented behaviour. */
const FULL_MATCH_RE = /\/([^/\s]+)\/([^/\s]*)$/;

/** `/\/([^/\s]*)$/` — matches `/toolkitName` (no second slash yet); also matches a bare `"/"`. */
const TOOLKIT_ONLY_MATCH_RE = /\/([^/\s]*)$/;

/** Parses `textToCursor`'s trailing slash-mention fragment into `{fullMatch, toolkitOnlyMatch}` — see `SlashFullMatch`'s doc comment for why this exists (isolates all `RegExpMatchArray` indexing to this one function). */
export function matchSlashFragment(textToCursor: string): { readonly fullMatch: SlashFullMatch | null; readonly toolkitOnlyMatch: SlashToolkitOnlyMatch | null } {
  const full = FULL_MATCH_RE.exec(textToCursor);
  if (full) {
    return { fullMatch: { raw: full[0], toolkitName: full[1] ?? '', toolQuery: full[2] ?? '' }, toolkitOnlyMatch: null };
  }
  const toolkitOnly = TOOLKIT_ONLY_MATCH_RE.exec(textToCursor);
  if (toolkitOnly) {
    return { fullMatch: null, toolkitOnlyMatch: { raw: toolkitOnly[0], toolkitName: toolkitOnly[1] ?? '' } };
  }
  return { fullMatch: null, toolkitOnlyMatch: null };
}

/** Pure utility: convert a committed mention entry to a toolkit object — `useSlashCommandHandler.hooks.js:4-10`'s `toolkitFromMention`. */
export function toolkitFromMention(mention: CommittedToolkitMention): SlashToolkitRef {
  return {
    id: mention.toolkitId,
    projectId: mention.projectId,
    name: mention.toolkitName,
    type: mention.toolkitType,
    ...(mention.toolkitSettings !== undefined ? { settings: mention.toolkitSettings } : {}),
  };
}

/** `useSlashCommandHandler.hooks.js:73-86`'s `getCommitedMentions` — replaces an existing mention with the same `(toolkitId, projectId)` identity, or appends a new one. */
export function mergeCommittedMention(
  prevCommittedMentions: readonly CommittedToolkitMention[],
  newMention: CommittedToolkitMention,
): readonly CommittedToolkitMention[] {
  const existingIndex = prevCommittedMentions.findIndex(
    (mention) => mention.toolkitId === newMention.toolkitId && mention.projectId === newMention.projectId,
  );
  if (existingIndex === -1) return [...prevCommittedMentions, { ...newMention }];
  return prevCommittedMentions.map((mention, index) => (index === existingIndex ? newMention : mention));
}

/** `uncommitMention`'s pure filter half (`useSlashCommandHandler.hooks.js:167-173`). */
function withoutCommittedMention(
  prevCommittedMentions: readonly CommittedToolkitMention[],
  toolkitId: string,
  projectId: string,
): readonly CommittedToolkitMention[] {
  return prevCommittedMentions.filter((m) => !(m.toolkitId === toolkitId && m.projectId === projectId));
}

/**
 * `useSlashCommandHandler.hooks.js:167-173`'s `uncommitMention` — removes a
 * mention from state+ref by toolkit identity. Threaded through `ctx`
 * (rather than being a bare `useCallback` closing over component state)
 * because it is called from `idlePhase.ts`/`toolPhase.ts`'s standalone
 * phase-resolver functions, not just from the hook body itself.
 * `ctx.setters.setCommittedMentions`'s own implementation (in
 * `useSlashCommandHandler.ts`) keeps `ctx.refs.committedMentions` in sync
 * synchronously — callers never need to mirror it manually.
 */
export function uncommitMention(ctx: SlashHandlerContext, toolkitId: string, projectId: string): void {
  ctx.setters.setCommittedMentions((prev) => withoutCommittedMention(prev, toolkitId, projectId));
}

/** `useSlashCommandHandler.hooks.js:88-99`'s `resetSlash` — returns to 'idle', clearing every per-mention piece of state (but NOT `committedMentions`, which persist across a reset). */
export function resetSlash(ctx: SlashHandlerContext): void {
  ctx.refs.phaseCurrent = 'idle';
  ctx.setters.setPhase('idle');
  ctx.setters.setToolkitQuery('');
  ctx.setters.setToolQuery('');
  ctx.setters.setSelectedToolkit(null);
  ctx.setters.setIsQueryFinal(false);
  ctx.refs.pendingToolQuery = '';
  ctx.refs.mentionAnchor = null;
  ctx.refs.activeIndex = 0;
  ctx.setters.setActiveIndex(0);
}
