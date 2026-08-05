import { useEffect } from 'react';
import { useFormContext } from 'react-hook-form';

import { conversationStartersToStrings } from './conversationStarters.helpers';

/** The one field this hook actually watches — see the module doc comment for why only this much is typed. */
interface ConversationStartersFormShape {
  readonly version_details?: {
    readonly conversation_starters?: readonly unknown[];
  };
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useConversationStartersSync.hooks.js` — syncs the agent/pipeline editor's
 * live, in-progress `conversation_starters` field out to a caller-supplied
 * callback, so the chat page can preview starters as they're typed instead
 * of only after save. This is the real implementation for the DI slot
 * `features/agents/ui/AgentEditor.tsx` declares as `AgentEditorDeps.
 * useConversationStartersSync` (defaulted there to a no-op, with a doc
 * comment pointing at "a future features/chat build" — this hook).
 *
 * **Formik-dependency correction, disclosed.** The brief for this port
 * assumed `formik`/`useFormikContext()` were still in use here, matching
 * the baseline. Verified false: `package.json` has no `formik` dependency,
 * and `grep -rl "useFormikContext\|from 'formik'" src/` has zero hits
 * anywhere in this worktree. `features/agents/model/types.ts`'s own module
 * doc comment establishes the real, codebase-wide replacement: "This app
 * has no Formik dependency (react-hook-form + zod instead — see
 * `package.json`)". This port therefore reads `react-hook-form`'s own
 * ambient context (`useFormContext()`) instead of Formik's — the DIRECT,
 * proven precedent for "Formik ambient-context hook -> RHF ambient-context
 * hook" in this exact codebase is `pages/agents/useDiscardApplicationChanges.ts`
 * (`useFormContext().reset()` replacing `useFormikContext().resetForm()`,
 * "read from context rather than passed as a prop so the call signature
 * stays identical to the baseline's" — the identical shape this hook is in:
 * `AgentEditorDeps.useConversationStartersSync`'s signature, `(onChange) =>
 * void`, was already landed by unit A1 with no `values` parameter, so this
 * hook has no choice but to read the live value from *somewhere* ambient).
 *
 * **Composition constraint, disclosed (matches `pages/agents/
 * EditApplication.tsx`'s own doc comment for the identical class of hook):**
 * `useFormContext()` throws ("useFormContext must be used within
 * <FormProvider>") when there is no ancestor `<FormProvider>`. This hook
 * must therefore only be wired into `AgentEditorDeps.useConversationStartersSync`
 * for a render of `<AgentEditor>` that is ITSELF a descendant of an RHF
 * `<FormProvider>` owning a `version_details.conversation_starters` field —
 * e.g. only supplied in edit mode once the not-yet-landed
 * `ApplicationConfigurationForm` (`AgentEditor.tsx`'s own doc comment) wraps
 * its form in one, not in create mode (`useAgentEditorCreate.ts` owns create
 * state via plain `useState`, no RHF form at all). That composition
 * decision belongs to whichever future unit assembles `AgentEditorDeps`
 * (Wave-2 unit C6) — this hook does the same thing `useDiscardApplicationChanges`
 * already does: trusts call-site discipline instead of defensively guarding
 * against a missing provider (a guard would need an unsound nullable cast
 * around RHF's own non-nullable `useFormContext()` return type — not a
 * pattern proven anywhere in this codebase).
 *
 * The field path (`version_details.conversation_starters`) mirrors the
 * baseline's own Formik path (`useConversationStartersSync.hooks.js:15`)
 * verbatim — the best-available guess pending the not-yet-landed
 * `ApplicationConfigurationForm`'s real field names, which this unit has no
 * visibility into yet.
 */
export function useConversationStartersSync(onChange: ((starters: readonly string[]) => void) | undefined): void {
  const { watch } = useFormContext<ConversationStartersFormShape>();
  const liveStarters = watch('version_details.conversation_starters');

  useEffect(() => {
    onChange?.(conversationStartersToStrings(liveStarters));
  }, [liveStarters, onChange]);
}
