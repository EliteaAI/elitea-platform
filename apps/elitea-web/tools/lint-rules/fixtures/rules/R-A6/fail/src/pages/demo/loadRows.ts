/** R-A6 RED fixture: every hand-rolled envelope-unwrap form the rule fences. */
interface Row {
  readonly id: string;
}

/** 1. hard `.data.data` — `eliteaFetch` already unwrapped the transport once. */
export function readUsers(resp: { data: { data: { rows: Row[] } } }): Row[] {
  return resp.data.data.rows;
}

/** 2. the same doubled `.data`, without a list key on the end. */
export function readBody(resp: { data: { data: unknown } }): unknown {
  return resp.data.data;
}

/** 3. hand-rolled shape sniffing — and the fallback is the input itself. */
export function readRows(response: readonly Row[] | { rows: readonly Row[] }): readonly Row[] {
  return 'rows' in response ? response.rows : response;
}

/** 4. the `items` variant of the same sniff. */
export function readItems(response: readonly Row[] | { items: readonly Row[] }): readonly Row[] {
  return 'items' in response ? response.items : [];
}
