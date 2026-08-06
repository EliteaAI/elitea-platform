/**
 * Public surface of the SSE transport module (issue #92). Named exports
 * only (`elitea/no-export-all`), curated the same way `shared/config`'s
 * barrel is.
 *
 * `./testing.ts` is deliberately NOT re-exported: it is test-only
 * machinery, imported deeply by the tests that need it — the same split
 * `shared/api/socket/testing.ts` already uses.
 */
export { useEventSource } from './useEventSource';
