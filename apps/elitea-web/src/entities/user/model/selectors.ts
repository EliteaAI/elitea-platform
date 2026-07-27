import type { User } from './types';

/**
 * Initials from a display name — apps/elitea-ui/src/common/utils.jsx:93-98
 * `getInitials`: first char of the first word + first char of the last
 * word, uppercased. A single-word name yields just its first letter.
 */
export function userInitials(user: User): string {
  const parts = user.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** True when the user's `roles` array contains the given role name. */
export function userHasRole(user: User, role: string): boolean {
  return user.roles.includes(role);
}

/** Alphabetical name sort, case-insensitive. */
export function sortUsersByName(users: readonly User[]): User[] {
  return [...users].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
