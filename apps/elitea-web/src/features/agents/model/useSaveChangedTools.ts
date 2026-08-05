import { useCallback, useMemo } from 'react';

import type { AgentToolAssociation } from '../lib/types';

/**
 * Port of `apps/elitea-ui/src/hooks/application/useSaveChangedTools.js`.
 *
 * **`getChangedTools` — ported faithfully, real value.** Pure diff of two
 * tool-association arrays down to entries whose `settings.selected_tools`
 * changed, index-aligned exactly like the baseline (`currentTools[index]` vs
 * `originalTools[index]`). Reused across `useSaveVersion.ts`/
 * `useSaveNewVersion.ts` (both call `onSaveTools` before their own PUT/POST)
 * — same "tools first, then version data" ordering the baseline established.
 *
 * **`onSaveTools` — REAL, DISCLOSED BACKEND GAP, not a porting shortcut.**
 * The baseline's `saveChangedTools` PATCHes
 * `/tool/prompt_lib/{projectId}/{toolkitId}` with
 * `{entity_version_id, entity_id, entity_type, has_relation: true,
 * selected_tools}` via `useToolkitAssociateMutation`
 * (`apps/elitea-ui/src/api/toolkits.js`). Traced this all the way to the
 * real Go source rather than assuming either "it still exists" or "it's
 * gone":
 *
 * 1. The ROUTE exists — `internal/api/router.go:373`,
 *    `r.Patch("/tool/prompt_lib/{projectID}/{toolkitID}", toolkitHandler.Update)`
 *    — and `toolkitHandler.Update` (`internal/api/v2/toolkits/handler.go:599-668`)
 *    DOES special-case a `has_relation` key in the body into
 *    `updateToolRelation`, which reads `entity_version_id`/`entity_id`/
 *    `entity_type`/`has_relation` and inserts/deletes exactly one row in
 *    `entity_tool_mapping` — matching the baseline's fields.
 * 2. BUT `updateToolRelation` (handler.go:621-667) never reads
 *    `body["selected_tools"]` at all — `entity_tool_mapping` has no such
 *    column (`INSERT INTO entity_tool_mapping (entity_version_id, entity_id,
 *    entity_type, tool_id) ... ON CONFLICT ... DO NOTHING`). It is a boolean
 *    "is this toolkit attached to this version" relation, not a per-tool
 *    subset. Firing this PATCH again with the SAME `has_relation: true`
 *    (this hook's whole use case — the toolkit is already attached, only
 *    the SUBSET of selected sub-tools changed) is a genuine no-op server
 *    side (`ON CONFLICT DO NOTHING`) that would return 201 while persisting
 *    nothing — indistinguishable from success on the wire. Calling it would
 *    be actively misleading, not merely unimplemented.
 * 3. This endpoint is also NOT in the generated orval client at all (no
 *    `PATCH` entry alongside `useDeleteApplicationTool`'s `DELETE
 *    /tool/prompt_lib/...` in `shared/api/generated/applications/
 *    applications.ts`, confirmed by grepping the whole generated tree for
 *    `has_relation`/`entity_version_id` — the only hits are the UNRELATED
 *    `ApplicationRelation` schema, a different endpoint for sub-agent/
 *    pipeline embedding, not toolkit tool-subset selection).
 *
 * `onSaveTools` therefore does not attempt a network call: there is no
 * server-side representation of "selected_tools changed" to persist against
 * today. **It always resolves `true`, never `false`, for exactly the same
 * reason the baseline's gate never blocks a real user session:** the
 * baseline's `onSaveTools()`/`saveChangedTools()` only resolves `false` on a
 * genuine network/API failure of the PATCH call (`useSaveVersion.js:57-60`,
 * `useSaveNewVersion.js:144-146` both gate on `=== false`, i.e. a thrown
 * error or an `{error}` response) — and per gap #2 above, the real backend
 * always 201s that PATCH (it's a same-`has_relation` no-op, not a rejection).
 * So in the baseline this gate is, for a healthy session, unconditionally
 * `true`. Resolving `false` here whenever tools merely changed — rather than
 * only on a genuine failure, of which there can be none without a network
 * call — would turn a silent backend no-op into a hard client-side block on
 * saving the version at all (`useSaveVersion.ts`'s/`useSaveNewVersion.ts`'s
 * callers gate the PUT/POST on this exact boolean, matching the baseline's
 * own gate position). Instead, the changed entries are reported via
 * `UseSaveChangedToolsResult.unsavedTools` — a non-blocking side channel the
 * caller (this unit's consumers: `useSaveVersion.ts`/`useSaveNewVersion.ts`,
 * ultimately `AgentEditor.jsx`) can use to surface a "tool subset changes
 * weren't saved" warning without withholding the actual save.
 */

export interface ChangedTool {
  readonly index: number;
  readonly toolId: string | number | undefined;
  readonly currentSelectedTools: readonly string[];
  readonly originalSelectedTools: readonly string[];
  readonly toolData: AgentToolAssociation;
}

function selectedToolsOf(tool: AgentToolAssociation | undefined): readonly string[] {
  return tool?.settings?.selected_tools ?? [];
}

function selectedToolsChanged(current: readonly string[], original: readonly string[]): boolean {
  return (
    current.length !== original.length ||
    current.some((tool) => !original.includes(tool)) ||
    original.some((tool) => !current.includes(tool))
  );
}

/** `getChangedTools` — baseline `useSaveChangedTools.js:10-38`, ported verbatim (index-aligned comparison, not id-keyed — matching the baseline exactly). */
export function getChangedTools(
  currentTools: readonly AgentToolAssociation[] = [],
  originalTools: readonly AgentToolAssociation[] = [],
): readonly ChangedTool[] {
  const result: ChangedTool[] = [];
  currentTools.forEach((currentTool, index) => {
    const originalTool = originalTools[index];
    if (originalTool === undefined) return;

    const currentSelectedTools = selectedToolsOf(currentTool);
    const originalSelectedTools = selectedToolsOf(originalTool);

    if (selectedToolsChanged(currentSelectedTools, originalSelectedTools)) {
      result.push({ index, toolId: currentTool.id, currentSelectedTools, originalSelectedTools, toolData: currentTool });
    }
  });
  return result;
}

export interface UseSaveChangedToolsResult {
  /** Always resolves `true` — there is no network call that could genuinely fail; see the module doc comment for why this must not gate the version PUT/POST the way a real failure would in the baseline. */
  readonly onSaveTools: () => Promise<boolean>;
  readonly changedTools: readonly ChangedTool[];
  /** Non-empty exactly when there is real, unpersistable `selected_tools` state — see the module doc comment's gap #2. Non-blocking: callers should use this to surface a warning, not to withhold the save. */
  readonly unsavedTools: readonly ChangedTool[];
  readonly isSavingToolkit: false;
}

/**
 * @param currentTools `version_details.tools` from the form currently being edited.
 * @param originalTools `version_details.tools` from the version's last-saved/initial state.
 */
export function useSaveChangedTools(
  currentTools: readonly AgentToolAssociation[] | undefined,
  originalTools: readonly AgentToolAssociation[] | undefined,
): UseSaveChangedToolsResult {
  const changedTools = useMemo(() => getChangedTools(currentTools ?? [], originalTools ?? []), [currentTools, originalTools]);

  // Not `async` — there is no network call to await (see the module doc
  // comment's gap #2/#3); the `Promise<boolean>` return type is kept so
  // this still satisfies `useSaveVersion.ts`'s/`useSaveNewVersion.ts`'s
  // injected `onSaveTools: () => Promise<boolean>` gate shape exactly.
  // Always resolves `true` — see the module doc comment for why signaling
  // `false` here (rather than only on a genuine failure, of which there can
  // be none without a network call) would regress into blocking the version
  // save entirely, unlike the baseline's own gate.
  const onSaveTools = useCallback((): Promise<boolean> => {
    return Promise.resolve(true);
  }, []);

  return { onSaveTools, changedTools, unsavedTools: changedTools, isSavingToolkit: false };
}
