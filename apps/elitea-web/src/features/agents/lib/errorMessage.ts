/**
 * Renders a TanStack Query `error` (an `EliteaApiError`, per
 * `shared/api/generated/mutator.ts` — never the RTK-Query-shaped
 * `{status, data}` object the baseline's `common/utils.js` `buildErrorMessage`
 * expects) into a display string.
 *
 * Not a port of the baseline's `buildErrorMessage` (used throughout
 * `hooks/application/*` — `useSaveVersion.js`, `useSaveNewVersion.js`,
 * `useDeleteVersion.js`, `useSaveChangedTools.js`,
 * `useValidateApplicationVersion.js`, `useApplicationChatSwitchVersion.js`):
 * that function's whole dispatch table (`err.status === 403`,
 * `err.data.message`, a FastAPI/Pydantic validation-error array, ...) is
 * shaped for the OLD RTK-Query transport's error object AND the old
 * pylon/FastAPI backend's per-field validation envelope. The real Go
 * backend's documented error convention (`shared/api/generated/model/
 * applicationRelationList.zod.ts`'s own module doc: "General errors (4xx/5xx):
 * `{"error": "message"}`") carries a flat message, not a `[{loc, msg, ctx}]`
 * array — grepped the whole generated client for any per-field validation
 * envelope on these operations, zero hits. `EliteaApiError` already carries a
 * real, readable `.message` (`mutator.ts`'s `describeFailure`), so no dispatch
 * table is needed. Same fallback shape as `features/apps/lib/errorMessage.ts`
 * (`appDetailErrorMessage`, the first Wave-2 unit to hit this exact
 * situation) and `src/routes/-ui/RouteStatus.tsx`'s `RouteError` — not
 * imported (`no-sideways-features`/R-L3 forbid reaching into another
 * feature's internals), rebuilt locally, three bytes of logic.
 */
export function applicationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
