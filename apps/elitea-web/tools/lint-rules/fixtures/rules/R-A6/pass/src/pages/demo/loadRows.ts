/** R-A6 GREEN fixture: the compliant call site. */
import { unwrapList } from '../../shared/api/unwrap';

interface Row {
  readonly id: string;
}

/** The whole unwrap, envelope included, delegated to the one helper. */
export function readUsers(resp: unknown): Row[] {
  return unwrapList<Row>(resp, 'userList');
}

/**
 * react-query's `query.data` is always `T | undefined` and holds the orval
 * envelope, so `query.data?.data` is the sanctioned read of the BODY — the
 * optional link is what separates it from the banned hard `.data.data`.
 */
export function readBody(query: { data?: { data?: unknown } }): unknown {
  return query.data?.data;
}
