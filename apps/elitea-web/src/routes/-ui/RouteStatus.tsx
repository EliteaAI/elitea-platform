/**
 * Per-route `pendingComponent`/`errorComponent` (task item 5: "replacing
 * the old single global Suspense" — old app wraps the whole
 * `ProtectedRoutes` tree in one `<Suspense fallback={<LoadingPage/>}>`,
 * `ProtectedRoutes.jsx:254`). Every leaf route in this unit sets both
 * explicitly instead of relying on one shared boundary.
 */
import type { ErrorComponentProps } from '@tanstack/react-router';

import { t } from '@/shared/i18n';

export function RoutePending() {
  // `<output>`, not `<div role="status">`: oxlint's `jsx-a11y/prefer-tag-over-role`
  // requires the semantic element with the implicit role, not an ARIA
  // role bolted onto a generic div. `<output>` carries an implicit
  // `role="status"` (jsdom/testing-library resolve `getByRole('status')`
  // against it the same way).
  return <output>{t('routes.pending', 'Loading…')}</output>;
}

export function RouteError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert">
      <p>{t('routes.error', 'Something went wrong.')}</p>
      <p>{message}</p>
    </div>
  );
}
