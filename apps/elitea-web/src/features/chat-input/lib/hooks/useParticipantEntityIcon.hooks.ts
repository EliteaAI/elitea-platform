/**
 * Scoped local port of `apps/elitea-ui/src/[fsd]/features/chat/participants/
 * lib/hooks/useParticipantEntityIcon.hooks.js` — `AgentEditorPanel.tsx`'s
 * one consumer. No port anywhere else reachable (owned by unit C5,
 * `features/chat-participants/`, not yet built, and unreachable anyway —
 * `no-sideways-features`).
 *
 * DISCLOSED SCOPE REDUCTION: the baseline hook has TWO branches —
 * (1) `entity_name !== 'toolkit'`: return the participant's `icon_meta`
 * object verbatim; (2) `entity_name === 'toolkit'`: resolve a toolkit-type
 * icon via `ToolkitsHelpers.getToolkitIcon` (`features/toolkits` internals)
 * + `useGetCurrentToolkitSchemas` (also `features/toolkits`) — BOTH illegal
 * imports here regardless of ownership (`no-sideways-features` is
 * permanent). This is a non-issue in practice: `AgentEditorPanel`'s own
 * caller (`NewChatInput.tsx`) only ever renders it when `activeParticipant
 * .entityName` is `'application'` or `'pipeline'` (never `'toolkit'`) — the
 * toolkit branch is unreachable dead code at this call site. Only branch
 * (1) is ported; branch (2) is dropped entirely rather than reached for
 * illegally.
 *
 * The baseline's dummy-participant fallback (`!entity_name` ->
 * `EntityTypeIcon` component element) is ALSO unreachable here for the same
 * reason (an application/pipeline participant always has an `entity_name`)
 * — dropped too. Callers needing a true "no icon" fallback get `undefined`
 * back and render their own fallback glyph (`AgentEditorPanel.tsx` does,
 * via its own local `AgentEditorEntityIcon`).
 */
export interface ParticipantEntityIconMeta {
  readonly url?: string;
  readonly [key: string]: unknown;
}

/**
 * `entitySettings.iconMeta` is typed `unknown` on `entities/participant`'s
 * own `ParticipantSettings` (an opaque DB-jsonb passthrough — see that
 * type's own doc comment) — accepted here as `unknown` too so a real
 * `Participant` is structurally assignable without a caller-side cast,
 * then narrowed with a runtime object check before being handed back as
 * `ParticipantEntityIconMeta`.
 */
export interface ParticipantEntityIconInput {
  readonly entityName?: string;
  readonly entitySettings?: { readonly iconMeta?: unknown } | undefined;
}

function isIconMeta(value: unknown): value is ParticipantEntityIconMeta {
  return typeof value === 'object' && value !== null;
}

export function useParticipantEntityIcon(
  participant: ParticipantEntityIconInput | null | undefined,
): ParticipantEntityIconMeta | undefined {
  const iconMeta = participant?.entitySettings?.iconMeta;
  return isIconMeta(iconMeta) ? iconMeta : undefined;
}
