/**
 * `ChatBox`'s imperative handle type — its own file purely to stay under the
 * §3.5 400-line file budget on both `ChatBox.tsx` and `ChatBox.helpers.ts`
 * (both already near the limit once `editorCallbacks`/`participant`
 * bundling landed).
 */

/** @public Imperative handle proxied from `ChatBox`. */
export interface ChatBoxHandle {
  readonly onClear: () => void;
  readonly mentionUser: (content: string) => void;
  readonly stopAll: () => void;
}
