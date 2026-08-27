/**
 * State and data for `pages/admin/UserActivityDrawer.tsx`.
 *
 * ## This is `./useAuditDrawer`, pinned to one user
 *
 * Nothing else. The per-project drawer needed one extra query of its own (the
 * per-member strip); this drawer needs none — "what did this person do" is
 * already exactly what the audit endpoints answer with `user_id` set, so the
 * hook is the shared one plus a memoised pin.
 *
 * The pin is memoised because it is part of every query key: a fresh
 * `{ userId }` literal per render would be a fresh key per render, and
 * react-query would refetch forever.
 */
import { useMemo } from 'react';

import { useAuditDrawer, type AuditDrawerState } from './useAuditDrawer';

export function useUserActivityDrawer(userId: number): AuditDrawerState {
  const pin = useMemo(() => ({ userId: String(userId) }), [userId]);
  return useAuditDrawer(pin);
}
