/**
 * The imperative handle every "/" / "~" mention hook in this slice needs
 * from whatever chat-textarea component ends up rendering the actual
 * input. Baseline evidence: `useSlashMention.hooks.js`/
 * `useChatSkillMention.hooks.js` both call `chatInput.current
 * .getInputContent()`/`.getCursorPosition()`/`.replaceRange(start, end,
 * replacement)` on a ref to the old app's `UserInput`/`NewChatInput`
 * component (never any of that component's OTHER imperative methods, e.g.
 * `reset()`/`setValue()`/`removeSymbol()` — those belong to a different
 * caller, `ChatBox.jsx` itself, not to these two mention hooks).
 *
 * This unit (C3, "chat-input" mention systems) does not own the textarea
 * component itself — the composition-root unit (C6, "build last") does.
 * `ChatInputHandle` is the injected-slot CONTRACT between the two: C6's
 * real textarea component must implement this shape on whatever
 * `useImperativeHandle` ref it exposes, and pass that ref into
 * `useSlashMention`/`useChatSkillMention` below. A `RefObject<ChatInputHandle
 * | null>` (not the handle itself) is what both hooks actually take as a
 * parameter, matching how `chatInput` is always a ref, never a resolved
 * value, in the baseline.
 */
export interface ChatInputHandle {
  /** The textarea's current full text value. */
  getInputContent(): string;
  /** The caret position (or selection end) in `getInputContent()`'s text, or `null` if it cannot be determined (mirrors the baseline's optional-chained `?? null` reads). */
  getCursorPosition(): number | null;
  /** Replaces the `[start, end)` character range with `replacement`, WITHOUT firing the textarea's own `onChange` (the baseline's own documented contract — every caller manually mirrors the resulting text into its own `inputContent` state right after calling this, see `useSlashMention.hooks.js`'s `onSlashSelectToolkit`/`onSlashCommitMention`/`useChatSkillMention.hooks.js`'s `onSelectSkill`). */
  replaceRange(start: number, end: number, replacement: string): void;
}
