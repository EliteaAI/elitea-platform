import { MentionPhase } from '../constants/mention.constants';
import type { AgentToolAssociation } from '../types';
import type { CommittedMention } from './useInstructionsSlashCommand.hooks';

/**
 * Types + pure helpers extracted out of `useInstructionsMention.hooks.ts`
 * purely to keep that file's own `useInstructionsMention` function (and the
 * effect/callback bodies within it) under this codebase's
 * `complexity`/`max-lines` gates — see that file's own module doc comment
 * for the full baseline citation and disclosed-deviation list; this split
 * changes no behaviour.
 */

/**
 * Widens `AgentToolAssociation.settings` (this slice's shared "version
 * tools[] row" type, `../types.ts`) with `available_mcp_tools` — the field
 * this hook's baseline (`useInstructionsMention.hooks.js:19-26`,
 * `getValidToolNames`) actually reads for an MCP tool's valid-tool-name
 * set. `AgentToolSettings` (a DIFFERENT A1 sub-unit's owned type) declares
 * `available_tools`/`selected_tools` but not `available_mcp_tools` — rather
 * than assume those are the same field under a different name (unverified
 * without reading that sub-unit's own MCP-tools call sites), this widening
 * keeps both fields legally optional and reads the baseline's own field
 * name directly, matching what `instructionsMention.utils.ts`'s
 * `MentionableTool.settings` already declares.
 */
export interface MentionableTool extends Omit<AgentToolAssociation, 'settings'> {
  readonly id: string | number;
  readonly settings?: AgentToolAssociation['settings'] & {
    readonly available_mcp_tools?: readonly MentionableMcpTool[];
  };
}

export interface FileReaderInputHandle {
  getCursorPosition?: () => number;
  getInputContent?: () => string;
  replaceRange?: (start: number, end: number, replacement: string) => void;
}

/** One MCP sub-tool entry, as read off `MentionableTool.settings.available_mcp_tools` for the "/" mention tools-phase dropdown. `description` mirrors the baseline's own `item.description` (`useInstructionsMention.hooks.js:278-291`) — dropped in an earlier port pass; restored here so `resolveAvailableTools` below has a real field to read instead of a hardcoded `''`. */
interface MentionableMcpTool {
  readonly value?: string | undefined;
  readonly label?: string | undefined;
  readonly description?: string | undefined;
}

export interface FilteredMentionableItem {
  readonly name: string;
  readonly type: string | undefined;
  readonly agent_type: string | undefined;
  readonly settings: MentionableTool['settings'];
  readonly isToolkit: boolean;
  readonly description: string;
}

export interface KeyDownEvent {
  readonly key: string;
  readonly target?: { readonly selectionStart?: number };
  readonly preventDefault: () => void;
}

/**
 * Scans `text` for existing "/name" or "/name/tool" tokens matching
 * `mentionableItems`, seeding the slash-command machine's committed-
 * mentions list on mount/version-load. Pure extraction of
 * `useInstructionsMention.hooks.js`'s inline effect body (the baseline's
 * OWN "Seed committedMentions from the saved instructions text" comment).
 */
export function seedMentionsFromText(
  text: string | undefined,
  mentionableItems: readonly FilteredMentionableItem[],
): readonly CommittedMention[] {
  if (!text || !mentionableItems.length) return [];

  const mentions: CommittedMention[] = [];
  const sortedItems = [...mentionableItems].sort((a, b) => b.name.length - a.name.length);

  for (const item of sortedItems) {
    collectTokenMentions(text, item, mentions);
  }

  return dedupeMentions(mentions);
}

function collectTokenMentions(text: string, item: FilteredMentionableItem, mentions: CommittedMention[]): void {
  const baseToken = '/' + item.name;
  let pos = text.indexOf(baseToken);
  while (pos !== -1) {
    const prevChar = pos > 0 ? text[pos - 1] : '';
    if (prevChar === '' || (prevChar !== undefined && /\s/.test(prevChar))) {
      pushMentionAtToken(text, pos, baseToken, item, mentions);
    }
    pos = text.indexOf(baseToken, pos + 1);
  }
}

function pushMentionAtToken(
  text: string,
  pos: number,
  baseToken: string,
  item: FilteredMentionableItem,
  mentions: CommittedMention[],
): void {
  const after = text.slice(pos + baseToken.length);
  if (item.isToolkit && (after.startsWith('/') || after.startsWith('#'))) {
    const toolMatch = /^([^\s/#]+)/.exec(after.slice(1));
    mentions.push({ name: item.name, tool_name: toolMatch?.[1] ?? null });
  } else if (after === '' || (after[0] !== undefined && /[\s/#]/.test(after[0]))) {
    mentions.push({ name: item.name, tool_name: null });
  }
}

function dedupeMentions(mentions: readonly CommittedMention[]): readonly CommittedMention[] {
  const seen = new Set<string>();
  return mentions.filter((m) => {
    const key = m.name + '::' + String(m.tool_name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The text-replacement half of `onSelectTool(null)` — dismissing tool selection, committing the toolkit-only mention. */
export function computeDismissToolReplacement(
  anchor: number,
  selectedItemName: string,
): { readonly nameEnd: number; readonly replacement: string } {
  const nameEnd = anchor + ('/' + selectedItemName).length;
  return { nameEnd, replacement: '/' + selectedItemName + ' ' };
}

/** The text-replacement half of `onSelectTool(toolName)` — committing a specific tool within the selected toolkit. */
export function computeToolReplacement(
  content: string,
  anchor: number,
  selectedItemName: string,
  toolName: string,
): { readonly end: number; readonly replacement: string } {
  const namePrefix = '/' + selectedItemName;
  const afterNameStart = anchor + namePrefix.length;
  const afterName = content.slice(afterNameStart);
  const spaceIdx = afterName.search(/\s/);
  const end = afterNameStart + (spaceIdx === -1 ? afterName.length : spaceIdx);
  return { end, replacement: '/' + selectedItemName + '/' + toolName + ' ' };
}

export interface SelectedItemLike {
  readonly name: string;
  readonly settings?: MentionableTool['settings'];
  readonly type?: string | undefined;
}

/** Resolves the available-tools list for whichever toolkit is currently selected — pure extraction of `useInstructionsMention.hooks.js`'s `availableTools` `useMemo` body. */
export function resolveAvailableTools(
  resolvedSelectedItem: SelectedItemLike | null,
): readonly { readonly name: string; readonly description: string }[] {
  const settings = resolvedSelectedItem?.settings;
  if (!settings) return [];
  const isMcp = resolvedSelectedItem?.type === 'mcp' || resolvedSelectedItem?.type?.startsWith('mcp_');
  if (isMcp) {
    return (settings.available_mcp_tools ?? []).map((item) => ({ name: item.value ?? item.label ?? '', description: item.description ?? '' }));
  }
  return (settings.selected_tools ?? []).map((name) => ({ name, description: '' }));
}

export interface ItemsPhaseKeyDeps {
  readonly filteredItems: readonly FilteredMentionableItem[];
  readonly highlightedIndex: number;
  readonly setHighlightedIndex: (update: (prev: number) => number) => void;
  readonly onSelectItem: (item: FilteredMentionableItem, isToolkit: boolean) => void;
}

/** `onKeyDown`'s "phase === Items" branch — extracted so the main handler's own complexity stays under this codebase's gate. Returns `true` when the key was handled (caller should not fall through to the slash-machine's own handler). */
export function handleItemsPhaseKey(event: KeyDownEvent, deps: ItemsPhaseKeyDeps): boolean {
  const { filteredItems, highlightedIndex, setHighlightedIndex, onSelectItem } = deps;
  if (filteredItems.length === 0) return false;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setHighlightedIndex((prev) => (prev + 1) % filteredItems.length);
    return true;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    setHighlightedIndex((prev) => (prev <= 0 ? filteredItems.length - 1 : prev - 1));
    return true;
  }
  if (event.key === 'Enter' && highlightedIndex >= 0) {
    event.preventDefault();
    const item = filteredItems[highlightedIndex];
    if (item) onSelectItem(item, item.isToolkit);
    return true;
  }
  return false;
}

export interface ToolsPhaseKeyDeps {
  readonly filteredTools: readonly { readonly name: string; readonly description: string }[];
  readonly highlightedIndex: number;
  readonly setHighlightedIndex: (update: (prev: number) => number) => void;
  readonly onSelectTool: (toolName: string | null) => void;
}

/** `onKeyDown`'s "phase === Tools" branch — same extraction rationale as {@link handleItemsPhaseKey}. */
export function handleToolsPhaseKey(event: KeyDownEvent, deps: ToolsPhaseKeyDeps): boolean {
  const { filteredTools, highlightedIndex, setHighlightedIndex, onSelectTool } = deps;
  if (filteredTools.length === 0) return false;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setHighlightedIndex((prev) => (prev + 1) % filteredTools.length);
    return true;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    setHighlightedIndex((prev) => (prev <= 0 ? filteredTools.length - 1 : prev - 1));
    return true;
  }
  if (event.key === 'Enter' && highlightedIndex >= 0) {
    event.preventDefault();
    const tool = filteredTools[highlightedIndex];
    if (tool) onSelectTool(tool.name);
    return true;
  }
  return false;
}

export { MentionPhase };
