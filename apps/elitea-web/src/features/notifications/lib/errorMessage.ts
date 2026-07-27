/**
 * features/notifications/lib/errorMessage.ts — adapts `eliteaFetch`'s
 * thrown `EliteaApiError` (§3.6's discriminated `HttpFailure`, unwrapped to
 * a throw at the react-query boundary by `shared/api/generated/mutator.ts`)
 * to `shared/lib/http-error.ts`'s `buildErrorMessage` (unit S3), which
 * expects the OLD app's RTK-Query `FetchBaseQueryError` shape
 * (`{status, originalStatus, data}`). `http-error.ts`'s own doc comment
 * flags exactly this adaptation as Wave-2 work: "A Wave-2 feature unit
 * wiring a TanStack Query error into UI copy will need to either adapt the
 * error at the call site to this shape or extend this function."
 *
 * **Blocked, documented (not silently dropped):** there is no `useToast`
 * equivalent anywhere in Wave 0/1's output. The baseline's `useToast`
 * (`apps/elitea-ui/src/hooks/useToast.jsx`) reads a `ToastContext` mounted
 * by `components/ToastProvider` at the app-composition root — that is
 * `app/`/`widgets/app-shell/` territory (R2/W-shell), strictly above
 * `features/` (R-L1), and outside this unit's ownership fence
 * (`src/features/notifications/` only). `NotificationListItem` therefore
 * cannot call a toast function directly; it exposes the built message via
 * an `onMarkToggleError` callback prop instead (dependency injection — the
 * eventual toast wiring is the CALLER's job, once a toast system lands),
 * with a `console.error` fallback so a caller that ignores the prop still
 * surfaces the failure somewhere rather than swallowing it silently.
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
 * (the old app had no 401/403/network/abort handling at all — §5.4/F4's own
 * report) so they get a short, honest, non-baseline message rather than
 * being forced through `buildErrorMessage`'s `data.*` branches with an
 * empty body.
 */
export function notificationErrorMessage(error: unknown): string {
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
