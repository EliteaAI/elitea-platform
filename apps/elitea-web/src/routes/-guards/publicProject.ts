/**
 * `PUBLIC_PROJECT_ID` comparison (old app: `src/common/constants.js:61`,
 * `PUBLIC_PROJECT_ID = +VITE_PUBLIC_PROJECT_ID`). Unit F3's
 * `vite_public_project_id` config key (spec §7.1 C7) is the new home for
 * the env var; this reproduces the numeric-coercion + loose-equality
 * comparison `SkillsGuard.jsx:13` (`projectId == PUBLIC_PROJECT_ID`) and
 * `IntegrationGuard.jsx:13` (`projectId != PUBLIC_PROJECT_ID`) use, ported
 * as an explicit string comparison (both sides coerced the same way) so the
 * behaviour does not depend on JS's loose-equality coercion rules.
 */
import { getConfig } from '@/shared/config';

/** `true` when `selectedProjectId` is the tenant's public project. */
export function isPublicProject(selectedProjectId: string | undefined): boolean {
  const config = getConfig();
  if (config.status !== 'ok') return false;
  if (selectedProjectId === undefined) return false;
  return String(selectedProjectId) === String(config.config.vite_public_project_id);
}
