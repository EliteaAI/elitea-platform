/**
 * Renders a TanStack Query `error` (an `EliteaApiError`, per
 * `shared/api/generated/mutator.ts` — never the RTK-Query-shaped
 * `{status, data}` object `shared/lib/http-error.ts`'s `buildErrorMessage`
 * expects) into a display string.
 *
 * Not a port of the baseline's `buildErrorMessage` — that function's
 * whole dispatch table (`err.status === 403`, `err.data.message`, a
 * FastAPI/Pydantic validation-error array, ...) is shaped for the OLD
 * RTK-Query transport's error object; `EliteaApiError` already carries a
 * real, readable `.message` (`mutator.ts`'s `describeFailure`), so no
 * dispatch table is needed here. Same fallback shape as `RouteError`
 * (`src/routes/-ui/RouteStatus.tsx`, unit R1) for consistency across the
 * app: an `Error` instance's own `.message`, else `String(error)`.
 */
export function appDetailErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
