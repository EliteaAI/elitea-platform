import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { buildVersionValidationKey, useApplicationsStore } from '../../model/applicationsStore';
import { isPrebuildMcpType } from '../mcpType';
import {
  createMentionCmExtension,
  getItemDescription,
  isToolkitItem,
  parseMentionRanges,
  type MentionableItem,
} from '../utils/instructionsMention.utils';
import {
  MentionPhase,
  computeDismissToolReplacement,
  computeToolReplacement,
  handleItemsPhaseKey,
  handleToolsPhaseKey,
  resolveAvailableTools,
  seedMentionsFromText,
} from './instructionsMention.helpers';
import type { FileReaderInputHandle, FilteredMentionableItem, KeyDownEvent, MentionableTool } from './instructionsMention.helpers';
import { useInstructionsSlashCommand } from './useInstructionsSlashCommand.hooks';
import type { CommittedMention } from './useInstructionsSlashCommand.hooks';

export type { FileReaderInputHandle, FilteredMentionableItem, MentionableTool };

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/agent/lib/hooks/useInstructionsMention.hooks.js`.
 *
 * Higher-level hook that wires the "/" instructions slash-command state
 * machine ({@link useInstructionsSlashCommand}) to actual textarea text
 * manipulation via the `FileReaderInput` component ref, and resolves the
 * live list of mentionable tools (toolkits/MCPs/sub-agents/pipelines) from
 * the current version's `tools[]`.
 *
 * Split across this file and `instructionsMention.helpers.ts` (types + pure
 * computations) purely to keep every function under this codebase's
 * `complexity`/`max-lines` gates — no behaviour differs from a single-file
 * port.
 *
 * **DEVIATIONS FROM BASELINE (all disclosed):**
 *
 *  1. `useToolsValidationInfo` (`hooks/application/useValidateApplicationVersion.js`)
 *     -> read directly off `features/agents/model/applicationsStore.ts`'s
 *     `versionValidationInfo` slot via its own `buildVersionValidationKey`
 *     (both already landed in this slice by a sibling A1 sub-unit — reused
 *     intra-slice, not duplicated). **Real, disclosed backend gap** (same
 *     one `entities/application-form/model/validationStatus.ts` already
 *     documents at length): the generated client's `useValidateApplicationVersion`
 *     is a `{valid: boolean}` existence check with no `toolkit_errors`
 *     detail, so nothing currently WRITES this store slot — every tool
 *     therefore reads as "not invalid" (filtered out of mentions only once
 *     a future unit's write-side lands). Not invented; the store key and
 *     shape already match where a real write will land.
 *
 *  2. `McpAuthHelpers.getAccessToken`/`.isPrebuildMcpType`
 *     (`@/[fsd]/features/mcp/lib/helpers`) -> `isPrebuildMcpType` is reused
 *     from this slice's own `../mcpType.ts` (a sibling A1 sub-unit's local
 *     duplicate of `features/mcps/lib/storage.ts`'s classifier —
 *     `no-sideways-features` forbids importing `features/mcps` directly,
 *     see that file's own doc comment). `getAccessToken` (a stateful
 *     sessionStorage read of an OAuth token, real MCP-login domain logic —
 *     not a one-line classifier like `isPrebuildMcpType`) has no local
 *     duplicate anywhere in this slice yet and duplicating a whole
 *     token-storage read here would be a worse, driftable duplication of
 *     `features/mcps`' actual login state. `isToolLoggedIn` is therefore an
 *     OPTIONAL injected predicate instead (default: assume logged in, i.e.
 *     do not additionally filter on login state) — the caller (a
 *     page/widget layer, which MAY legally import both `features/agents`
 *     and `features/mcps`) supplies the real check by composing
 *     `features/mcps`' own exported `getAccessToken`, matching this batch's
 *     "restructure via injected callback, do not create a forbidden
 *     cross-feature import" precedent (see `useDisassociateToolkit.hooks.ts`'s
 *     own doc comment for the same pattern).
 *
 *  3. `window.addEventListener(McpAuthConstants.MCP_TOKEN_CHANGE_EVENT, ...)`
 *     -> since login-state filtering is now the caller's responsibility
 *     (deviation 2), the caller is also responsible for re-invoking this
 *     hook's consumer when MCP login state changes (e.g. by bumping a key
 *     it passes through `isToolLoggedIn`'s own referential identity, or a
 *     `features/mcps`-side `useMcpTokenChange` hook it composes itself).
 *     This hook does not listen for that event directly, for the same
 *     "would require reaching into `features/mcps`" reason.
 */
export interface UseInstructionsMentionParams {
  readonly fileReaderRef: RefObject<FileReaderInputHandle | null>;
  readonly applicationId: string | number | undefined;
  readonly projectId: string | undefined;
  readonly versionId: string | number | undefined;
  readonly tools: readonly MentionableTool[] | undefined;
  readonly instructions: string | undefined;
  /** Text color used for the CodeMirror mention highlight decoration (theme.palette.text.info in the baseline). */
  readonly highlightColor: string;
  /** See module doc comment, deviation 2. Defaults to "always logged in" (no additional login-state filtering). */
  readonly isToolLoggedIn?: (tool: MentionableTool) => boolean;
}

export interface UseInstructionsMentionResult {
  readonly phase: (typeof MentionPhase)[keyof typeof MentionPhase];
  readonly itemQuery: string;
  readonly toolQuery: string;
  readonly selectedItem: { readonly name: string; readonly settings?: MentionableTool['settings'] } | null;
  readonly committedMentions: readonly CommittedMention[];
  readonly mentionableItems: readonly FilteredMentionableItem[];
  readonly filteredItems: readonly FilteredMentionableItem[];
  readonly filteredTools: readonly { readonly name: string; readonly description: string }[];
  readonly highlightedIndex: number;
  readonly highlightRanges: ReturnType<typeof parseMentionRanges>;
  readonly codeMirrorExtensions: ReturnType<typeof createMentionCmExtension>;
  readonly onKeyDown: (event: KeyDownEvent) => void;
  readonly onInstructionsInputChange: (value: string) => void;
  readonly onSelectItem: (item: FilteredMentionableItem, isToolkit: boolean) => void;
  readonly onSelectTool: (toolName: string | null) => void;
  readonly resetSlash: () => void;
}

function useMentionableItems(
  tools: readonly MentionableTool[] | undefined,
  projectId: string | undefined,
  applicationId: string | number | undefined,
  versionId: string | number | undefined,
  isToolLoggedIn: ((tool: MentionableTool) => boolean) | undefined,
): readonly FilteredMentionableItem[] {
  const validationKey = useMemo(() => buildVersionValidationKey(projectId, applicationId, versionId), [projectId, applicationId, versionId]);
  const versionValidationInfo = useApplicationsStore((state) => state.versionValidationInfo);
  const toolsValidationInfo = useMemo(() => {
    const info: Record<string | number, boolean> = {};
    for (const entry of versionValidationInfo[validationKey] ?? []) {
      const loc = entry['loc'];
      const id = Array.isArray(loc) ? (loc as readonly unknown[])[1] : undefined;
      if (typeof id === 'string' || typeof id === 'number') info[id] = true;
    }
    return info;
  }, [versionValidationInfo, validationKey]);

  return useMemo(
    () =>
      (tools ?? [])
        .filter((tool) => isMentionableTool(tool, toolsValidationInfo, isToolLoggedIn))
        .map((tool) => ({
          name: tool.name ?? '',
          type: tool.type,
          agent_type: tool.agent_type,
          settings: tool.settings,
          isToolkit: isToolkitItem(tool),
          description: getItemDescription(tool),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [tools, toolsValidationInfo, isToolLoggedIn],
  );
}

function isMentionableTool(
  tool: MentionableTool,
  toolsValidationInfo: Record<string | number, boolean>,
  isToolLoggedIn: ((tool: MentionableTool) => boolean) | undefined,
): boolean {
  if (toolsValidationInfo[tool.id]) return false;
  if (tool.type === 'mcp') {
    return tool.online === true || !isToolLoggedIn || isToolLoggedIn(tool);
  }
  if (isPrebuildMcpType(tool.type)) {
    return !isToolLoggedIn || isToolLoggedIn(tool);
  }
  return true;
}

export function useInstructionsMention({
  fileReaderRef,
  applicationId,
  projectId,
  versionId,
  tools,
  instructions,
  highlightColor,
  isToolLoggedIn,
}: UseInstructionsMentionParams): UseInstructionsMentionResult {
  const inputContentRef = useRef('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const mentionableItems = useMentionableItems(tools, projectId, applicationId, versionId, isToolLoggedIn);

  const {
    phase,
    itemQuery,
    toolQuery,
    selectedItem,
    committedMentions,
    onKeyDown: slashOnKeyDown,
    syncWithValue,
    selectItem,
    commitMention: slashCommitMention,
    resetSlash,
    initCommittedMentions,
    mentionAnchorRef,
  } = useInstructionsSlashCommand();

  useEffect(() => {
    initCommittedMentions(seedMentionsFromText(instructions, mentionableItems));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);

  const highlightRanges = useMemo(
    () => parseMentionRanges(instructions ?? '', mentionableItems as readonly MentionableItem[]),
    [instructions, mentionableItems],
  );

  const codeMirrorExtensions = useMemo(
    () => createMentionCmExtension(mentionableItems as readonly MentionableItem[], highlightColor),
    [mentionableItems, highlightColor],
  );

  const filteredItems = useMemo(() => {
    if (!mentionableItems.length) return [];
    if (!itemQuery) return mentionableItems;
    return mentionableItems.filter((item) => item.name.toLowerCase().includes(itemQuery.toLowerCase()));
  }, [mentionableItems, itemQuery]);

  const replaceFragment = useCallback(
    (replacement: string, endOverride?: number) => {
      const ref = fileReaderRef.current;
      if (!ref) return;
      const content = ref.getInputContent?.() ?? inputContentRef.current;
      const anchor = mentionAnchorRef.current ?? 0;
      const end = endOverride ?? ref.getCursorPosition?.() ?? content.length;
      ref.replaceRange?.(anchor, end, replacement);
      inputContentRef.current = content.slice(0, anchor) + replacement + content.slice(end);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileReaderRef],
  );

  const onInstructionsInputChange = useCallback(
    (value: string) => {
      inputContentRef.current = value;
      if (!value) {
        resetSlash();
        return;
      }
      const cursorPos = fileReaderRef.current?.getCursorPosition?.() ?? value.length;
      syncWithValue(value, cursorPos);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncWithValue, resetSlash],
  );

  const onSelectItem = useCallback(
    (item: FilteredMentionableItem, isToolkit: boolean) => {
      replaceFragment(isToolkit ? '/' + item.name : '/' + item.name + ' ');
      selectItem(item, isToolkit);
    },
    [replaceFragment, selectItem],
  );

  const onSelectTool = useCallback(
    (toolName: string | null) => {
      if (selectedItem) {
        const ref = fileReaderRef.current;
        const content = ref?.getInputContent?.() ?? inputContentRef.current;
        const anchor = mentionAnchorRef.current ?? 0;

        let end: number;
        let replacement: string;
        if (toolName === null) {
          const dismiss = computeDismissToolReplacement(anchor, selectedItem.name);
          end = dismiss.nameEnd;
          replacement = dismiss.replacement;
        } else {
          const commit = computeToolReplacement(content, anchor, selectedItem.name, toolName);
          end = commit.end;
          replacement = commit.replacement;
        }

        ref?.replaceRange?.(anchor, end, replacement);
        inputContentRef.current = content.slice(0, anchor) + replacement + content.slice(end);
      }
      slashCommitMention(toolName);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileReaderRef, selectedItem, slashCommitMention],
  );

  const resolvedSelectedItem = useMemo(() => {
    if (!selectedItem) return null;
    if ('settings' in selectedItem) return selectedItem;
    return mentionableItems.find((item) => item.name === selectedItem.name) ?? selectedItem;
  }, [selectedItem, mentionableItems]);

  const availableTools = useMemo(() => resolveAvailableTools(resolvedSelectedItem), [resolvedSelectedItem]);

  const filteredTools = useMemo(
    () => availableTools.filter((tool) => !toolQuery || tool.name.toLowerCase().includes(toolQuery.toLowerCase())),
    [availableTools, toolQuery],
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [phase, filteredItems, filteredTools]);

  const onKeyDown = useCallback(
    (event: KeyDownEvent) => {
      if (phase === MentionPhase.Items && handleItemsPhaseKey(event, { filteredItems, highlightedIndex, setHighlightedIndex, onSelectItem })) {
        return;
      }
      if (phase === MentionPhase.Tools && handleToolsPhaseKey(event, { filteredTools, highlightedIndex, setHighlightedIndex, onSelectTool })) {
        return;
      }
      slashOnKeyDown(event);
    },
    [phase, filteredItems, filteredTools, highlightedIndex, onSelectItem, onSelectTool, slashOnKeyDown],
  );

  return {
    phase,
    itemQuery,
    toolQuery,
    selectedItem: resolvedSelectedItem,
    committedMentions,
    mentionableItems,
    filteredItems,
    filteredTools,
    highlightedIndex,
    highlightRanges,
    codeMirrorExtensions,
    onKeyDown,
    onInstructionsInputChange,
    onSelectItem,
    onSelectTool,
    resetSlash,
  };
}
