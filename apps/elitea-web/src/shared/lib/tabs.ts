/**
 * Tab-key arrays ported from apps/elitea-ui/src/common/constants.js:482-495
 * (unit S3, spec §9.3).
 *
 * These are `:tab` route-param value sets (route-adjacent, like `params.ts`)
 * — checked against P1's manifest, which tracks tab ROUTES (ROUTE-051…066
 * etc.) separately from this literal key list; no duplicate ownership.
 */
export const publicTabs = ['latest', 'my-liked', 'trending'] as const;
export const ApplicationsTabs = ['latest', 'my-liked', 'trending', 'admin'] as const;
export const SkillsTabs = ['all'] as const;
export const ToolkitsTabs = ['all', 'my-liked', 'trending', 'admin'] as const;
export const AppsTabs = ['applications', 'catalog'] as const;
export const CredentialsTabs = ['all'] as const;
export const PrivateApplicationTabs = [
  'all',
  'drafts',
  'published',
  'moderation',
  'approval',
  'rejected',
] as const;
export const UserSettingsTabs = ['information', 'tokens', 'secrets', 'projects'] as const;
export const UserPublicTabs = ['all', 'agents', 'pipelines', 'toolkits', 'MCPs'] as const;
