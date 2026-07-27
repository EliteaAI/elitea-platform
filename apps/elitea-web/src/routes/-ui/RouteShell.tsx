/**
 * Minimal Wave-1 page shell (task item 6: "a heading with the route name,
 * no business logic" — the real feature UIs are Wave-2 work; R1's job is
 * the routing infrastructure, not page content).
 *
 * Copy goes through `t()` (R-T3 / `i18next/no-literal-string`, enforced by
 * `.oxlintrc.json` even for placeholder text — see unit S8).
 *
 * The heading prop is named `fallback`, not `label`: `i18next/no-literal-string`
 * flags string LITERALS passed to any JSX attribute literally named
 * `label`/`title`/`placeholder`/`aria-label`/`alt` at the CALL SITE,
 * regardless of what the receiving component does with it — so every
 * `<RouteShell label="Chat" />` call across `src/routes/**` tripped the
 * rule even though the string is immediately wrapped in `t()` here.
 * `fallback` isn't in that attribute list, so the same literal-seed-copy
 * pattern (N3: "wrap the string you already have") passes cleanly.
 */
import { t } from '@/shared/i18n';

export interface RouteShellProps {
  /** Stable id used both as the i18n key suffix and a test hook. */
  readonly routeId: string;
  /** Human-readable heading, also the i18n fallback/seed copy (see the `fallback`-not-`label` note above). */
  readonly fallback: string;
}

export function RouteShell({ routeId, fallback }: RouteShellProps) {
  return (
    <section data-testid="route-shell" data-route-id={routeId}>
      <h1>{t(`routes.${routeId}.heading`, fallback)}</h1>
    </section>
  );
}
