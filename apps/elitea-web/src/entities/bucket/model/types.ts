/**
 * Bucket domain type — mirrors OpenAPI schema `Bucket`
 * (services/elitea-main/api/openapi/v2.yaml:1702-1713, unit W2), sourced from
 * internal/api/v2/artifacts/handler.go:21-26 (struct json tags, no
 * `omitempty` — all four fields always present on the wire).
 */
export interface Bucket {
  readonly id: string;
  readonly name: string;
  readonly isPinned: boolean;
  /** ISO 8601 date-time. */
  readonly createdAt: string;
}

/**
 * Wire-shape (snake_case) as returned by the Go handler, before the
 * `lib/normalise.ts` camelCase mapping. Kept alongside `Bucket` so the
 * normaliser's input type is evidenced, not `any`.
 */
export interface BucketWire {
  readonly id: string;
  readonly name: string;
  readonly is_pinned: boolean;
  readonly created_at: string;
}
