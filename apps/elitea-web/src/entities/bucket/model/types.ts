/**
 * Bucket domain type — mirrors the `Bucket` struct the Go handler serialises
 * (services/elitea-main/internal/api/v2/artifacts/handler.go:27-37), the
 * element type of `GET /api/v2/artifacts/buckets/{projectID}`'s `buckets`.
 */
export interface Bucket {
  /** The bucket NAME — the server exposes no surrogate id, and a name is unique per project. */
  readonly id: string;
  readonly name: string;
  readonly isPinned: boolean;
  /** ISO 8601 date-time. */
  readonly createdAt: string;
}

/**
 * Wire-shape (snake_case) as returned by the Go handler, before the
 * `lib/normalise.ts` camelCase mapping. Only the fields the UI reads are
 * declared; the handler also sends tags/retention/size/counts.
 */
export interface BucketWire {
  readonly name: string;
  readonly is_pinned: boolean;
  readonly created_at: string;
}
