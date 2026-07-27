import type { Author } from './types';

/**
 * Display name — an Author's `name` is always present on the wire
 * (`required: [id, email, name]`, v2.yaml:326), but old-app call sites
 * defensively fall back to email (e.g. author maps built from partial
 * client state). Guards a blank name the same way.
 */
export function authorDisplayName(author: Author): string {
  return author.name.trim() !== '' ? author.name : author.email;
}

/**
 * Identity comparison by id — apps/elitea-ui/src/components/DataRowAction.jsx
 * :92,120 (`state.user.id === data?.author_id`) and
 * apps/elitea-ui/src/components/Categories.jsx:84
 * (`state.user.author_id === myAuthorId`) both reduce to an author-id
 * equality check; ported here as one pure comparator rather than the two
 * divergent redux-field read patterns the old app has.
 */
export function isSameAuthor(a: Author, b: Author): boolean {
  return a.id === b.id;
}

/** True when `author.id` matches the given current-user author id. */
export function isCurrentUserAuthor(author: Author, currentUserAuthorId: string | undefined): boolean {
  return currentUserAuthorId !== undefined && author.id === currentUserAuthorId;
}
