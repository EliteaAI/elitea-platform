/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/shared/lib/utils/instructionsMention.utils.js`
 * (byte-for-byte behaviour: `isToolkitItem`, `getItemDescription`,
 * `parseMentionRanges`, `createMentionCmExtension`).
 *
 * **Placement (disclosed, not a promotion):** same rationale as
 * `../constants/mention.constants.ts` — the baseline keeps this in
 * `shared/lib/`, but only this sub-unit's four instructions-mention hooks
 * consume it today, and `shared/lib/**` is unit S3's owned surface, not
 * A1b's. Kept feature-local; promote to `shared/lib` if a future consumer
 * outside `features/agents` needs it.
 */
import { RangeSetBuilder, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

/**
 * A version `tools[]` entry, or a mentionable-item projection of one — just
 * the fields `isToolkitItem`/`getItemDescription` read. `name` is optional
 * here (neither function reads it) even though every REAL caller's tool
 * entry has one — {@link MentionableItem} (used by `parseMentionRanges`/
 * `createMentionCmExtension`, which DO need a name to build a mention
 * token) narrows it back to required.
 */
export interface MentionableTool {
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

// ── Item type helpers ─────────────────────────────────────────────────────────

/** `instructionsMention.utils.js:6`. An `application`-type tool (sub-agent/pipeline) is not a toolkit. */
export function isToolkitItem(tool: MentionableTool): boolean {
  return tool.type !== 'application';
}

/** `instructionsMention.utils.js:8-13`. */
export function getItemDescription(tool: MentionableTool): string {
  if (tool.type === 'application') {
    return tool.agent_type === 'pipeline' ? 'Pipeline' : 'Agent';
  }
  return 'Toolkit';
}

/**
 * Returns the Set of valid tool names for a toolkit item, or `null` if the
 * item has no `settings` (validation not possible — all names accepted).
 * `instructionsMention.utils.js:19-26`.
 */
function getValidToolNames(item: MentionableItem): ReadonlySet<string> | null {
  if (!item.settings) return null;
  const isMcp = item.type === 'mcp' || item.type?.startsWith('mcp_');
  if (isMcp) {
    return new Set((item.settings.available_mcp_tools ?? []).map((t) => t.value ?? t.label ?? ''));
  }
  return new Set(item.settings.selected_tools ?? []);
}

export interface MentionRange {
  readonly start: number;
  readonly end: number;
}

// ── Mention range parser ──────────────────────────────────────────────────────

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
 * whitespace. `instructionsMention.utils.js:40-82`, ported line-for-line
 * (split across this function and `resolveMentionEnd`/`resolveToolkitMentionEnd`/
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

// ── CodeMirror extension factory ──────────────────────────────────────────────

/**
 * Creates a CodeMirror extension that highlights mention tokens within the
 * editor content, using {@link parseMentionRanges} so both '/' and '#'
 * separators are highlighted. `instructionsMention.utils.js:95-121`.
 */
export function createMentionCmExtension(
  mentionableItems: readonly MentionableItem[] | undefined,
  primaryColor: string,
  triggerChar = '/',
): readonly Extension[] {
  if (!mentionableItems?.length) return [];

  const highlightMark = Decoration.mark({ class: 'cm-mention-highlight' });

  const computeDecorations = (state: { doc: { toString(): string } }) => {
    const text = state.doc.toString();
    const decorationRanges = parseMentionRanges(text, mentionableItems, triggerChar);
    const builder = new RangeSetBuilder<Decoration>();
    for (const { start, end } of decorationRanges) {
      builder.add(start, end, highlightMark);
    }
    return builder.finish();
  };

  return [
    EditorView.theme({ '.cm-mention-highlight': { color: primaryColor } }),
    StateField.define({
      create: computeDecorations,
      update(decorations, tr) {
        if (!tr.docChanged) return decorations;
        return computeDecorations(tr.state);
      },
      provide: (f) => EditorView.decorations.from(f),
    }),
  ];
}
