/**
 * `ChatBox`'s imperative handle type — its own file purely to stay under the
 * §3.5 400-line file budget on both `ChatBox.tsx` and `ChatBox.helpers.ts`
 * (both already near the limit once `editorCallbacks`/`participant`
 * bundling landed).
 */

/**
 * @public Imperative handle proxied from `ChatBox` to whatever host mounts it
 * (baseline: `ChatPanel.jsx`'s `ref.stopAll`/`ref.onClear` — see
 * `features/pipelines`'s `ChatBoxSlotHandle`).
 *
 * `ChatBox` exposes this on its own `ref` PROP. It must never be attached to
 * the internal `chatInputRef`: that is the same ref `<NewChatInput
 * ref={chatInputRef}>` writes its `NewChatInputHandle` into, so attaching
 * here overwrites that handle on commit and every consumer of the input's
 * imperative surface (`getCursorPosition`/`replaceRange`/`reset`/`setValue`
 * — the "/" and "~" mention hooks, the voice button) throws "is not a
 * function" on each keystroke.
 */
export interface ChatBoxHandle {
  readonly onClear: () => void;
  readonly mentionUser: (content: string) => void;
  readonly stopAll: () => void;
}
