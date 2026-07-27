/**
 * Version domain type — an application/agent/pipeline version. Mirrors
 * OpenAPI schemas `ApplicationVersionDetail`, `ApplicationVersionSummary`,
 * `VersionMeta`, `VersionTag`, `VersionVariable`, `VersionToolRef`, `Author`
 * (services/elitea-main/api/openapi/v2.yaml:324-334,363-660, unit W2),
 * sourced from internal/api/v2/applications/handler.go
 * (fetchVersionDetails :325-342, CreateVersion :783-801, UpdateVersion
 * :913-919) and internal/api/v2/eliteacore/handler.go (Fork :2440-2456).
 *
 * Field presence genuinely varies by endpoint (NOTE(W2), v2.yaml:643-659) —
 * this type union-shapes every field the handlers can emit and marks as
 * optional anything not common to all of them. `VersionSummary` is the
 * lighter row shape used in application version lists.
 */

/**
 * Inline author shape (mirrors entities/author's `Author`, v2.yaml:324-334)
 * — duplicated rather than imported, per the dependency-cruiser
 * `no-sideways-entities` rule (entities may not import one another).
 */
export interface VersionAuthor {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface VersionVariable {
  /**
   * Nullable AND optional: v2.yaml:574-591 — DB-backed paths always emit
   * both keys as strings, but the CreateVersion echo path returns the
   * client's raw variables array verbatim, so a key can be ABSENT entirely
   * (not merely null) when the client's payload omitted it.
   */
  readonly name?: string | null;
  readonly value?: string | null;
}

export interface VersionTag {
  /** Nullable: Fork's unvalidated echo can produce `{"name": null, ...}`. */
  readonly name: string | null;
  /** Opaque DB-jsonb passthrough (`tags.data`); shape is caller-defined. */
  readonly data?: unknown;
}

/**
 * `VersionToolRef` — two DB row shapes merged into one `tools[]` array
 * (NOTE(W2), v2.yaml:562-572): `entity_tool_mapping` rows carry
 * id/toolId/entityType/selectedTools; `application_tools` rows carry
 * id/name/type/settings(+authorId+projectId). Only `id` is common to both.
 */
export interface VersionToolRef {
  readonly id: number;
  readonly toolId?: number;
  readonly entityType?: string;
  /** Opaque; shape varies by toolkit type. */
  readonly selectedTools?: unknown;
  readonly name?: string;
  readonly type?: string;
  /** Opaque toolkit-type-specific settings blob (`config` alias in some endpoints). */
  readonly config?: unknown;
  readonly settings?: unknown;
  readonly authorId?: string;
  readonly projectId?: number;
}

export interface VersionMeta {
  readonly stepLimit?: number | null;
  /** Opaque passthrough — verbatim from the UpdateIcon request body. */
  readonly iconMeta?: Readonly<Record<string, unknown>>;
  readonly category?: string;
  readonly sourceVersionId?: string;
  readonly parentEntityId?: string;
  readonly parentProjectId?: string;
  readonly parentAuthorId?: string;
  readonly variables?: readonly VersionVariable[];
  readonly attachmentStorage?: { readonly toolkitId?: string };
}

export interface VersionSummary {
  /** Numeric id serialized as string. */
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly agentType: string;
  readonly createdAt: string;
}

export interface Version {
  /** Numeric id serialized as string. */
  readonly id: string;
  readonly applicationId: string;
  readonly name: string;
  readonly status: string;
  /** Absent on some endpoints (e.g. UpdateVersion's 10-key subset). */
  readonly createdAt?: string;
  readonly agentType?: string;
  /** Always `""` (never absent) when the DB column is NULL. */
  readonly instructions?: string;
  /** Always `""` (never absent) when the DB column is NULL. */
  readonly welcomeMessage?: string;
  /** Opaque DB-jsonb passthrough; only a handful of keys are ever inspected. */
  readonly llmSettings?: Readonly<Record<string, unknown>>;
  readonly meta?: VersionMeta | null;
  /** Opaque DB-jsonb array passthrough. */
  readonly conversationStarters?: readonly unknown[];
  /** Opaque DB-jsonb passthrough; never inspected server-side. */
  readonly pipelineSettings?: Readonly<Record<string, unknown>>;
  readonly authorId?: string;
  /**
   * `ApplicationVersionDetail.author` (v2.yaml:632) — a SIBLING optional
   * property of `authorId`, not a duplicate. NOTE(W2), v2.yaml:643-656:
   * the two are populated on DISJOINT endpoints — `fetchVersionDetails`
   * always adds `author_id` but NOT `author` (applications/handler.go:
   * 325-342); `CreateVersion` adds `author` (+ `is_forked`) but not
   * `author_id` (:783-801); neither is present on `UpdateVersion`'s 10-key
   * subset (:913-919) or `publicApplicationDetail` (eliteacore/handler.go:
   * 1460-1475).
   */
  readonly author?: VersionAuthor;
  readonly tools?: readonly VersionToolRef[];
  readonly tags?: readonly VersionTag[];
  readonly variables?: readonly VersionVariable[];
  readonly isForked?: boolean;
}
