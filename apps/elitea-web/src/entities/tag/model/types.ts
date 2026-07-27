/**
 * Tag domain type — mirrors OpenAPI schema `Tag` / `TagsList`
 * (services/elitea-main/api/openapi/v2.yaml:1937-1961, unit W2).
 *
 * `data` is an opaque DB-jsonb passthrough (NOTE(W2), v2.yaml:1943-1948):
 * `Data any` on the Go struct, never inspected by the handlers and
 * round-tripped verbatim. Typed `unknown` rather than invented — no
 * evidenced shape exists for its contents.
 */
export interface Tag {
  readonly id: number;
  readonly name: string;
  readonly data: unknown;
}

/** `TagsList` (v2.yaml:1952-1961) — the paginated-by-nothing list envelope. */
export interface TagsPage {
  readonly rows: readonly Tag[];
  readonly total: number;
}
