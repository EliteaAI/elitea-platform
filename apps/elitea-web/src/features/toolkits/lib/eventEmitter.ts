/**
 * Ported verbatim from `apps/elitea-ui/src/common/eventEmitter.js` (22
 * lines) — a plain `{event: listener[]}` pub/sub bus, used by
 * `ToolkitsOperationButtons.tsx`/`ToolkitForm.tsx` to coordinate the
 * Save/Validate event flow (`entities/toolkit`'s `ToolEvents` catalogue)
 * across the two components without prop-drilling every handler through.
 *
 * Local, not shared: no other sub-unit's owned files reference
 * `common/eventEmitter.js` (grepped the whole old app: every consumer is
 * inside `features/toolkits`'s own `ui/form/ToolkitForm/` tree or the
 * `pages/`-layer callers that compose it — out of this port's reach either
 * way), so there is no cross-slice need to promote this to `shared/lib`.
 */
type Listener = (data: unknown) => void;

const listenersByEvent: Record<string, Listener[]> = {};

export const eventEmitter = {
  on(event: string, listener: Listener): void {
    (listenersByEvent[event] ??= []).push(listener);
  },

  emit(event: string, data?: unknown): void {
    for (const listener of listenersByEvent[event] ?? []) listener(data);
  },

  off(event: string, listener: Listener): void {
    const listeners = listenersByEvent[event];
    if (!listeners) return;
    listenersByEvent[event] = listeners.filter((candidate) => candidate !== listener);
  },
};
