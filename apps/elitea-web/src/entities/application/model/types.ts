/**
 * Application domain type — the agent/pipeline "container" entity. Mirrors
 * OpenAPI schemas `Application`, `ApplicationList`, `ApplicationDetail`,
 * `ApplicationCreatedResponse`, `ApplicationUpdatedResponse`,
 * `ApplicationVersionDetail`, `Author`
 * (services/elitea-main/api/openapi/v2.yaml:324-334,456-720,611-660,
 * 684-721, unit W2) — every one of those five response/detail schemas is
 * modeled below, not merely cited — sourced from
 * internal/domain/applications/types.go:11-31 and
 * internal/api/v2/applications/handler.go.
 *
 * `Pipeline` (entities/pipeline) and the public marketplace `App`
 * (entities/app) are both views over this same underlying Go resource, but
 * per the layer rule (dependency-cruiser `no-sideways-entities`) entities may
 * not import one another — each slice re-declares the minimal inline shape
 * it needs rather than importing this file. See entities/pipeline and
 * entities/app for the deliberate duplication.
 */

/**
 * Inline author shape (mirrors entities/author's `Author`) — duplicated
 * rather than imported; see the module doc for why.
 */
export interface ApplicationAuthor {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/**
 * Inline version-summary shape (mirrors entities/version's `VersionSummary`)
 * — duplicated rather than imported; see the module doc for why.
 */
export interface ApplicationVersionSummary {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly agentType: string;
  readonly createdAt: string;
}

/**
 * NOTE(W2): required set = json tags WITHOUT `omitempty` (id, name,
 * createdAt, ownerId, isForked, meta, hasInterrupt) PLUS updatedAt, whose
 * `omitempty` is ineffective on a `time.Time` (always marshaled; carries the
 * zero sentinel `"0001-01-01T00:00:00Z"` when the List path never scans the
 * column — v2.yaml:479-486). Every other field is optional.
 */
export interface Application {
  readonly id: string;
  readonly projectId?: string;
  readonly name: string;
  readonly description?: string;
  readonly type?: string;
  readonly icon?: string;
  readonly tags?: readonly string[];
  readonly folderId?: string;
  readonly status?: string;
  /** `map[string]any` on the domain struct, emitted verbatim. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  /** Always present; carries the zero sentinel when unscanned (see doc). */
  readonly updatedAt: string;
  readonly createdBy?: string;
  readonly ownerId: string;
  readonly authors?: readonly ApplicationAuthor[];
  readonly isForked: boolean;
  /** APP-level `applications.meta` jsonb — a DIFFERENT column from a version's meta. */
  readonly meta: Readonly<Record<string, unknown>> | null;
  readonly hasInterrupt: boolean;
  readonly agentType?: string;
}

export interface ApplicationPage {
  readonly rows: readonly Application[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

/**
 * Inline duplicate of `ApplicationVersionDetail` (v2.yaml:611-660) — see
 * entities/version's `Version`/`VersionAuthor` for the canonical, more
 * fully-commented definition (including the field-presence-varies-by-
 * endpoint notes); duplicated rather than imported per the
 * `no-sideways-entities` rule.
 */
export interface ApplicationVersionDetail {
  readonly id: string;
  readonly applicationId: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt?: string;
  readonly agentType?: string;
  readonly instructions?: string;
  readonly welcomeMessage?: string;
  readonly llmSettings?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>> | null;
  readonly conversationStarters?: readonly unknown[];
  readonly pipelineSettings?: Readonly<Record<string, unknown>>;
  readonly authorId?: string;
  readonly author?: ApplicationAuthor;
  readonly tools?: readonly unknown[];
  readonly tags?: readonly unknown[];
  readonly variables?: readonly { readonly name?: string | null; readonly value?: string | null }[];
  readonly isForked?: boolean;
}

/**
 * `ApplicationDetail` (v2.yaml:661-682) — the single-application Get
 * response, with the version list plus (when at least one version's detail
 * row loads) the expanded `versionDetails` of the current/latest version.
 */
export interface ApplicationDetail {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  /** Populated from `applications.created_by`. */
  readonly ownerId: string;
  readonly createdAt: string;
  readonly versions: readonly ApplicationVersionSummary[];
  readonly versionDetails?: ApplicationVersionDetail;
}

/**
 * `ApplicationCreatedResponse` (v2.yaml:684-704) — the Create response map
 * (internal/api/v2/applications/handler.go:465-478). `versionDetails` and
 * `versions` (a single-element echo of `versionDetails`) appear only when
 * the request carried a `versions` array (:374-463).
 */
export interface ApplicationCreatedResponse {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly icon: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly versionDetails?: ApplicationVersionDetail;
  readonly versions?: readonly ApplicationVersionDetail[];
}

/**
 * `ApplicationUpdatedResponse` (v2.yaml:706-720) — the Update response map
 * (internal/api/v2/applications/handler.go:575-611).
 */
export interface ApplicationUpdatedResponse {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly versionDetails?: ApplicationVersionDetail;
}
