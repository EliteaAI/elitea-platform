import { useEffect, useMemo } from 'react';

import { useNavigate, useParams } from '@tanstack/react-router';

/** Tab identifiers that have explicit files in `routes/_shell/settings/`. */
const VALID_TABS = [
  'model-configuration',
  'prompts',
  'environment',
  'project-params',
  'secrets',
  'users',
  'analytics',
  'personalization',
  'tokens',
  'notifications',
] as const;

/** Old tabs that mapped to `model-configuration` in the original app. */
const LEGACY_TABS = ['configuration', 'information'] as const;

/**
 * Handles backwards-compatible navigation for settings routes.
 *
 * - Missing tab param (when parent route is active) → redirect to default.
 * - Legacy tab identifiers (`configuration`, `information`) → redirect to
 *   `model-configuration`.
 * - Unrecognised tabs (e.g. `integrations`, which has no explicit file) →
 *   redirect to `model-configuration`.
 *
 * Renders `null` — side-effect only.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/settings-drawer/SettingsRedirect.jsx`.
 */
export function SettingsRedirect() {
  const { tab } = useParams({ strict: false });
  const navigate = useNavigate();

  const shouldRedirect = useMemo(() => {
    if (!tab) return true;
    if (LEGACY_TABS.includes(tab as (typeof LEGACY_TABS)[number])) return true;
    if (!VALID_TABS.includes(tab as (typeof VALID_TABS)[number])) return true;
    return false;
  }, [tab]);

  useEffect(() => {
    if (shouldRedirect) {
      // oxlint-disable-next-line typescript/no-floating-promises -- navigate() returns Promise<void>; we fire-and-forget.
      void navigate({ to: '/settings/model-configuration', replace: true });
    }
  }, [navigate, shouldRedirect]);

  return null;
}
