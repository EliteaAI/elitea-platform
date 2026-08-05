/**
 * Local duplicate of `features/agents/lib/errorMessage.ts` (byte-for-byte;
 * `no-sideways-features` forbids importing it) — same three-line rationale:
 * this slice's hand-registered `api/configurations.ts` fetchers go through
 * `eliteaFetch` and throw a real `EliteaApiError` (`mutator.ts`'s
 * `describeFailure`) on failure, which already carries a readable
 * `.message`; no old-app RTK-Query-shaped dispatch table is needed.
 */
export function toolkitFormErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
