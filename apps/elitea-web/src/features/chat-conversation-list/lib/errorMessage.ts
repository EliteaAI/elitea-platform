/**
 * `features/chat-conversation-list/lib/errorMessage.ts` — adapts
 * `eliteaFetch`'s thrown `EliteaApiError` (§3.6's discriminated
 * `HttpFailure`, unwrapped to a throw at the react-query boundary by
 * `shared/api/generated/mutator.ts`) to `shared/lib/http-error.ts`'s
 * `buildErrorMessage`, which expects the OLD app's RTK-Query
 * `FetchBaseQueryError` shape (`{status, originalStatus, data}`) — every
 * `folderApi`/`conversationApi` call in this slice's `lib/hooks/*` throws
 * the FORMER, not the latter, so calling `buildErrorMessage` directly on a
 * caught error here would silently resolve to `undefined` (verified by
 * this file's own adversarial-verify pass: `error.status`/`error.data`
 * don't exist on `EliteaApiError`, only `error.failure.{status,body}` do).
 *
 * Duplicated (not imported) from `features/notifications/lib/
 * errorMessage.ts`'s own byte-identical adapter — `no-sideways-features`
 * forbids reaching into another feature slice's internals even for a
 * verbatim-identical 30-line helper; this is the established precedent for
 * exactly that situation (see this codebase's other per-feature
 * `errorMessage.ts`/`lib/errorMessage.ts` copies in `features/apps`,
 * `features/toolkits`, `features/agents`).
 */
import { EliteaApiError } from '@/shared/api/generated/mutator';
import { buildErrorMessage } from '@/shared/lib/http-error';

/**
 * Mirrors `common/utils.jsx:145-183`'s message selection as closely as the
 * new transport's error shape allows. `kind: 'http'` maps
 * `{status, url, body}` -> `{status, originalStatus: status, data: body}` —
 * `buildErrorMessage` reads the 404 case off `originalStatus` and the 403
 * case off `status` (two different RTK-Query fields, both derived from the
 * SAME raw HTTP status in the old transport); this adapter's single
 * `HttpFailure.status` is exactly that raw status, so both fields carry it.
 * The other three `HttpFailure` kinds have no baseline RTK-Query equivalent
 * so they get a short, honest, non-baseline message rather than being
 * forced through `buildErrorMessage`'s `data.*` branches with an empty body.
 */
export function conversationListErrorMessage(error: unknown): string {
  if (error instanceof EliteaApiError) {
    const { failure } = error;
    switch (failure.kind) {
      case 'http': {
        const built = buildErrorMessage({ status: failure.status, originalStatus: failure.status, data: failure.body });
        return typeof built === 'string' ? built : JSON.stringify(built);
      }
      case 'auth':
        return 'Authentication is required to complete this action.';
      case 'network':
        return failure.message;
      case 'aborted':
        return 'The request was cancelled.';
      default:
        return failure satisfies never;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
