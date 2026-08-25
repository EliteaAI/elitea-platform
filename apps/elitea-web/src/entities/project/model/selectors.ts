import type { Project } from './types';

/**
 * Recurring inline predicate in the old app
 * (`projectId == PUBLIC_PROJECT_ID`), e.g. apps/elitea-ui/src/GA.js:36,
 * apps/elitea-ui/src/[fsd]/app/routes/SkillsGuard.jsx:13. The reserved
 * public/marketplace project id is NOT a fixed constant — it is
 * `VITE_PUBLIC_PROJECT_ID`, a per-deployment runtime-config value
 * (apps/elitea-ui/src/common/constants.js:14,61: `PUBLIC_PROJECT_ID =
 * +VITE_PUBLIC_PROJECT_ID`) — so it is a required parameter here rather than
 * an invented in-package constant; `shared/config` (unit F3) is the source
 * of the real value at the call site. The old app compares with `==` (the
 * id may arrive as a string from a route param); this selector normalises
 * both sides to string for the same effect without a loose-equality lint
 * violation.
 */
export function isPublicProject(projectId: number | string, publicProjectId: number | string): boolean {
  return String(projectId) === String(publicProjectId);
}

/**
 * `suspended` is the only suspension signal the server sends. The spec also
 * declared a `status` enum, but internal/api/v2/projects/handler.go never
 * emits it, so the old `project.status === 'suspended'` arm compared
 * `undefined` and could never be true.
 */
export function isSuspendedProject(project: Project): boolean {
  return project.suspended;
}

/** Alphabetical name sort, case-insensitive. */
export function sortProjectsByName(projects: readonly Project[]): Project[] {
  return [...projects].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
