/**
 * Renders a TanStack Query `error` into a display string. Local duplicate of
 * `features/agents/lib/errorMessage.ts`'s `applicationErrorMessage` — see
 * that file's own doc comment for the full rationale (this app's
 * `EliteaApiError` already carries a readable `.message`; the baseline's
 * `buildErrorMessage`'s RTK-Query/FastAPI-shaped dispatch table has no
 * faithful target against the real Go backend's flat `{"error": "message"}`
 * envelope). Not imported from `features/agents` — `no-sideways-features`
 * forbids it; three bytes of logic, duplicated per this codebase's own
 * established convention for this exact situation.
 */
export function pipelineErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
