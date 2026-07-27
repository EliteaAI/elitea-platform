/**
 * Author domain type — mirrors OpenAPI schema `Author`
 * (services/elitea-main/api/openapi/v2.yaml:324-334, unit W2), sourced from
 * internal/domain/applications/types.go:5-9 (no `omitempty` on any field —
 * all three are always present on the wire) and the inline author maps in
 * internal/api/v2/applications/handler.go:451,600,790.
 */
export interface Author {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/**
 * `TrendingAuthor` (v2.yaml:1324-1331). NOTE(W2): the backing endpoint
 * (`TrendingAuthors`, internal/api/v2/eliteacore/handler.go:1582-1584) is a
 * stub that always returns `[]` — the Go side defines no element shape.
 * Modelled as `Author` plus an optional trend-rank placeholder rather than
 * invented fields; flagged in the E1 report as unconfirmed (no live shape
 * evidence exists anywhere in the stack).
 */
export interface TrendingAuthor extends Author {
  /** Unconfirmed — no field exists on the Go stub response. Reserved. */
  readonly rank?: number;
}
