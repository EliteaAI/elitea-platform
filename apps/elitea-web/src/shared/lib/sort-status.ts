/**
 * Sort/collection-status enums ported from
 * apps/elitea-ui/src/common/constants.js (unit S3, spec §9.3).
 */

/** `constants.js:195-208`. */
export const SortOrderOptions = {
  ASC: 'asc',
  DESC: 'desc',
} as const;

export const SortFields = {
  Id: 'id',
  Authors: 'author',
  CreatedAt: 'created_at',
  Likes: 'likes',
  Name: 'name',
  Rate: 'rate',
  Online: 'online',
} as const;

/** `constants.js:243-277`. */
export const CollectionStatus = {
  All: 'all',
  Draft: 'draft',
  Published: 'published',
  OnModeration: 'on_moderation',
  UserApproval: 'user_approval',
  Rejected: 'rejected',
} as const;

/**
 * NOT ported here: `getStatusColor(status, theme)` (old-app
 * `utils.jsx:185-198`) switches over exactly these `CollectionStatus`
 * values to return `theme.palette.status.{draft,onModeration,published,
 * rejected,userApproval}`. It is a real, live helper — 4 consumer sites,
 * all in `apps/elitea-ui/src/components/{StatusBar,StatusDot}.jsx` (2 each:
 * one `import`, one `getStatusColor(status, theme)` call) — but it is
 * theme-coupled: under R-T7 (`theme.palette.*`/`theme.vars.palette.*` is
 * banned outside `shared/brand/`), it cannot live in `shared/lib` and must
 * be ported into `shared/brand` instead (a T1-adjacent unit, or S1 since
 * both `StatusBar`/`StatusDot` are `shared/ui`-shaped components). Flagged
 * here — where its switch target (`CollectionStatus`) already lives — per
 * the S3 report, rather than silently ported or silently dropped.
 */

/** User-visible `label`s (see S3 report re: S8/i18n). */
export const MyLibraryStatusOptions = [
  { value: CollectionStatus.All, label: 'All statuses' },
  { value: CollectionStatus.Draft, label: 'Draft' },
  { value: CollectionStatus.Published, label: 'Published' },
  { value: CollectionStatus.OnModeration, label: 'On Moderation' },
  { value: CollectionStatus.UserApproval, label: 'User Approval' },
  { value: CollectionStatus.Rejected, label: 'Rejected' },
] as const;
