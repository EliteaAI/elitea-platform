/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/lib/helpers/
 * conversationStarters.helpers.js` (single-export file, byte-for-byte
 * logic). Coerces a conversation-starter value — which may be
 * `null`/`undefined` (a cleared field) or a stray non-string left over from
 * an older payload — into a definite string, the same "safe stringify"
 * `AgentEditorDeps.onConversationStartersChange` and `ChatConversationStarters`
 * both need before they can `.trim()`/render a starter.
 *
 * Deliberately DUPLICATED, not imported, even though an identical port
 * already landed at `features/agents/lib/helpers/conversationStarters.helpers.ts`
 * (`export function toString`) — `no-sideways-features` (`.dependency-
 * cruiser.cjs`) forbids any `features/chat-input` -> `features/agents`
 * import, including this two-line pure function. Same small-function-
 * duplication precedent that copy's own doc comment already established
 * relative to the old app, and that `AgentPipelineVersionSelector.tsx`
 * applies to its own `LATEST_VERSION_NAME` constant across an `entities/`
 * boundary.
 *
 * Renamed from the shared `toString` to `conversationStarterToString` here
 * (both copies share the identical body) purely for call-site legibility —
 * a bare `toString(...)` reads as shadowing `Object.prototype.toString`.
 */
export function conversationStarterToString(value: string | number | boolean | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Maps a raw `readonly unknown[]` conversation-starters array (the shape
 * both `ApplicationVersionDetail.conversationStarters` and a live RHF field
 * value carry) through `conversationStarterToString`. A plain
 * `.map(conversationStarterToString)` does not typecheck directly —
 * `Array<unknown>.map` requires a `(value: unknown, ...) => T` callback,
 * and `conversationStarterToString`'s deliberately-narrowed parameter type
 * (see its own doc comment: the `no-base-to-string` fix) does not accept
 * `unknown`. The cast here is the one, reviewed place that bridges the two:
 * every conversation-starter entry this app ever produces is JSON-shaped
 * (persisted through a plain text/array form field, never a class
 * instance), so `string | number | boolean | null | undefined` covers every
 * real value `conversationStarterToString`'s own fallback `String(value)`
 * would need to handle safely.
 */
export function conversationStartersToStrings(values: readonly unknown[] | undefined): readonly string[] {
  return (values ?? []).map((value) => conversationStarterToString(value as string | number | boolean | null | undefined));
}
