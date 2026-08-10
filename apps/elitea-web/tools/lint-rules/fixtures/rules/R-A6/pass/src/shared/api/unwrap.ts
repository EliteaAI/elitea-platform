/**
 * R-A6 GREEN fixture: a stand-in for the real `src/shared/api/unwrap.ts`.
 *
 * Kept local (rather than importing the production module) so the fixture is a
 * self-contained mini-app like every other case here. The production file is
 * exempted by the same path-scoped override this fixture inherits, so the
 * hand-rolled forms below — `.data.data` and `'rows' in x`, the ones the rule
 * bans everywhere else — must not be reported here. A GREEN failure on this
 * file means the sanctioned path stopped being sanctioned.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The banned hard `.data.data` chain, legal here and only here. */
function peelEnvelope(response: { data: { data: unknown } }): unknown {
  return response.data.data;
}

export function unwrapList<T>(response: unknown, context: string): T[] {
  const body = isRecord(response) && 'status' in response ? peelEnvelope(response as { data: { data: unknown } }) : response;
  if (Array.isArray(body)) return [...(body as T[])];
  if (isRecord(body)) {
    if ('items' in body) return [...((body['items'] ?? []) as T[])];
    if ('rows' in body) return [...((body['rows'] ?? []) as T[])];
  }
  console.error(`unwrapList(${context}): unrecognised list response shape`);
  return [];
}
