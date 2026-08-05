import type {
  Application,
  ApplicationAuthor,
  ApplicationCreatedResponse,
  ApplicationDetail,
  ApplicationPage,
  ApplicationUpdatedResponse,
  ApplicationVersionDetail,
  ApplicationVersionSummary,
} from '../model/types';

/**
 * Wire (snake_case) -> domain (camelCase) normalisers for the `application`
 * slice. Covers every schema `model/types.ts` mirrors: `Application`,
 * `ApplicationList`, `ApplicationDetail`, `ApplicationCreatedResponse`,
 * `ApplicationUpdatedResponse`, `ApplicationVersionDetail`,
 * `ApplicationVersionSummary`, `Author`
 * (services/elitea-main/api/openapi/v2.yaml:324-334,456-720, unit W2;
 * shared/api/generated/model/application.zod.ts, applicationList.zod.ts,
 * applicationDetail.zod.ts, applicationCreatedResponse.zod.ts,
 * applicationUpdatedResponse.zod.ts, applicationVersionDetail.zod.ts,
 * applicationVersionSummary.zod.ts, author.zod.ts). Go source:
 * internal/domain/applications/types.go:11-31,
 * internal/api/v2/applications/handler.go (List :101-107, Get :121-139,
 * fetchVersionDetails :159-165,325-342, Create :465-478, Update :575-611).
 *
 * `llmSettings`/`meta`/`conversationStarters`/`pipelineSettings`/`tools`/
 * `tags`/`variables` on `ApplicationVersionDetail` are opaque DB-jsonb
 * passthroughs per `model/types.ts` (this slice's inline duplicate
 * deliberately keeps them as `Record<string, unknown>`/`unknown[]` rather
 * than the more structured shapes `entities/version` gives the same wire
 * data) — there is no snake_case INSIDE those blobs to rename, so they are
 * carried through verbatim once the outer key is renamed to camelCase.
 *
 * Every optional wire field uses the `...(x !== undefined ? {...} : {})`
 * spread pattern (not a plain `key: wire.key` assignment) because this
 * project builds with `exactOptionalPropertyTypes: true` — an absent wire
 * key must produce an ABSENT domain key, never a present key holding
 * `undefined`.
 */

/**
 * Wire shape of `Author` (v2.yaml:324-334;
 * shared/api/generated/model/author.zod.ts) as embedded in
 * `Application.authors[]` and `ApplicationVersionDetail.author`. Field names
 * already match `ApplicationAuthor` 1:1 (no snake_case on this schema) —
 * still given its own mapper so both embedding sites share one
 * normalisation path and a future wire-drift is caught in one place.
 */
interface ApplicationAuthorWire {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

function normaliseApplicationAuthor(wire: ApplicationAuthorWire): ApplicationAuthor {
  return { id: wire.id, email: wire.email, name: wire.name };
}

/**
 * `Application` (v2.yaml:456-510; shared/api/generated/model/
 * application.zod.ts:42-70) — snake_case wire shape before this file's
 * camelCase mapping. Required set mirrors the zod schema's non-`.optional()`
 * fields (id, name, created_at, updated_at, owner_id, is_forked, meta,
 * has_interrupt); everything else is optional.
 */
export interface ApplicationWire {
  readonly id: string;
  readonly project_id?: string;
  readonly name: string;
  readonly description?: string;
  readonly type?: string;
  readonly icon?: string;
  readonly tags?: readonly string[];
  readonly folder_id?: string;
  readonly status?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly created_at: string;
  /** Always present on the wire — see the module-level ZERO_SENTINEL note in `model/selectors.ts`. */
  readonly updated_at: string;
  readonly created_by?: string;
  readonly owner_id: string;
  readonly authors?: readonly ApplicationAuthorWire[];
  readonly is_forked: boolean;
  readonly meta: Readonly<Record<string, unknown>> | null;
  readonly has_interrupt: boolean;
  readonly agent_type?: string;
}

/** snake_case wire shape -> camelCase `Application` domain type (v2.yaml:456-510). */
export function normaliseApplication(wire: ApplicationWire): Application {
  return {
    id: wire.id,
    ...(wire.project_id !== undefined ? { projectId: wire.project_id } : {}),
    name: wire.name,
    ...(wire.description !== undefined ? { description: wire.description } : {}),
    ...(wire.type !== undefined ? { type: wire.type } : {}),
    ...(wire.icon !== undefined ? { icon: wire.icon } : {}),
    ...(wire.tags !== undefined ? { tags: wire.tags } : {}),
    ...(wire.folder_id !== undefined ? { folderId: wire.folder_id } : {}),
    ...(wire.status !== undefined ? { status: wire.status } : {}),
    ...(wire.metadata !== undefined ? { metadata: wire.metadata } : {}),
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
    ...(wire.created_by !== undefined ? { createdBy: wire.created_by } : {}),
    ownerId: wire.owner_id,
    ...(wire.authors !== undefined ? { authors: wire.authors.map(normaliseApplicationAuthor) } : {}),
    isForked: wire.is_forked,
    meta: wire.meta,
    hasInterrupt: wire.has_interrupt,
    ...(wire.agent_type !== undefined ? { agentType: wire.agent_type } : {}),
  };
}

export function normaliseApplications(wire: readonly ApplicationWire[]): Application[] {
  return wire.map(normaliseApplication);
}

/**
 * `ApplicationList` (v2.yaml:512-526; shared/api/generated/model/
 * applicationList.zod.ts) — the List response envelope, before mapping to
 * `ApplicationPage`.
 */
export interface ApplicationListWire {
  readonly rows: readonly ApplicationWire[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
  readonly total_pages: number;
}

/** `ApplicationList` wire envelope -> camelCase `ApplicationPage` (v2.yaml:512-526). */
export function normaliseApplicationPage(wire: ApplicationListWire): ApplicationPage {
  return {
    rows: normaliseApplications(wire.rows),
    total: wire.total,
    page: wire.page,
    pageSize: wire.page_size,
    totalPages: wire.total_pages,
  };
}

/**
 * `ApplicationVersionSummary` (v2.yaml:528-541;
 * shared/api/generated/model/applicationVersionSummary.zod.ts) — the
 * `getVersions` row shape nested in `ApplicationDetail.versions`. All five
 * fields are required on this schema (unlike the version-detail union
 * below), so no spread pattern is needed.
 */
export interface ApplicationVersionSummaryWire {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly agent_type: string;
  readonly created_at: string;
}

export function normaliseApplicationVersionSummary(
  wire: ApplicationVersionSummaryWire,
): ApplicationVersionSummary {
  return {
    id: wire.id,
    name: wire.name,
    status: wire.status,
    agentType: wire.agent_type,
    createdAt: wire.created_at,
  };
}

/**
 * `ApplicationVersionDetail` (v2.yaml:611-660; shared/api/generated/model/
 * applicationVersionDetail.zod.ts) — union of the version-detail maps every
 * handler emits (field presence varies by endpoint, hence only id/
 * application_id/name/status are required — see the schema's NOTE(W2)).
 *
 * NOTE(W2), v2.yaml:643-656: `author_id` and `author` are a DISJOINT pair,
 * not duplicates of each other — `fetchVersionDetails` always adds
 * `author_id` but never `author`; `CreateVersion` adds `author` (+
 * `is_forked`) but never `author_id`. This normaliser maps whichever of the
 * two the wire actually sent and leaves the other key absent; it does not
 * invent one from the other.
 */
export interface ApplicationVersionDetailWire {
  readonly id: string;
  readonly application_id: string;
  readonly name: string;
  readonly status: string;
  readonly created_at?: string;
  readonly agent_type?: string;
  readonly instructions?: string;
  readonly welcome_message?: string;
  readonly llm_settings?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>> | null;
  readonly conversation_starters?: readonly unknown[];
  readonly pipeline_settings?: Readonly<Record<string, unknown>>;
  readonly author_id?: string;
  readonly author?: ApplicationAuthorWire;
  readonly tools?: readonly unknown[];
  readonly tags?: readonly unknown[];
  readonly variables?: readonly { readonly name?: string | null; readonly value?: string | null }[];
  readonly is_forked?: boolean;
}

/**
 * Split out of `normaliseApplicationVersionDetail` purely to keep each
 * function's cyclomatic complexity under the oxlint budget (12) — this
 * schema alone has 14 optional fields, each contributing one branch via the
 * `exactOptionalPropertyTypes`-driven conditional spread.
 */
function normaliseApplicationVersionDetailScalars(
  wire: ApplicationVersionDetailWire,
): Pick<ApplicationVersionDetail, 'createdAt' | 'agentType' | 'instructions' | 'welcomeMessage' | 'isForked'> {
  return {
    ...(wire.created_at !== undefined ? { createdAt: wire.created_at } : {}),
    ...(wire.agent_type !== undefined ? { agentType: wire.agent_type } : {}),
    ...(wire.instructions !== undefined ? { instructions: wire.instructions } : {}),
    ...(wire.welcome_message !== undefined ? { welcomeMessage: wire.welcome_message } : {}),
    ...(wire.is_forked !== undefined ? { isForked: wire.is_forked } : {}),
  };
}

/** See `normaliseApplicationVersionDetailScalars` — the opaque DB-jsonb-passthrough fields. */
function normaliseApplicationVersionDetailPassthroughs(
  wire: ApplicationVersionDetailWire,
): Pick<
  ApplicationVersionDetail,
  'llmSettings' | 'meta' | 'conversationStarters' | 'pipelineSettings' | 'tools' | 'tags' | 'variables'
> {
  return {
    ...(wire.llm_settings !== undefined ? { llmSettings: wire.llm_settings } : {}),
    ...(wire.meta !== undefined ? { meta: wire.meta } : {}),
    ...(wire.conversation_starters !== undefined ? { conversationStarters: wire.conversation_starters } : {}),
    ...(wire.pipeline_settings !== undefined ? { pipelineSettings: wire.pipeline_settings } : {}),
    ...(wire.tools !== undefined ? { tools: wire.tools } : {}),
    ...(wire.tags !== undefined ? { tags: wire.tags } : {}),
    ...(wire.variables !== undefined ? { variables: wire.variables } : {}),
  };
}

/**
 * See `normaliseApplicationVersionDetailScalars` — the disjoint author_id/
 * author pair (NOTE(W2), v2.yaml:643-656, see the interface doc above).
 */
function normaliseApplicationVersionDetailAuthorFields(
  wire: ApplicationVersionDetailWire,
): Pick<ApplicationVersionDetail, 'authorId' | 'author'> {
  return {
    ...(wire.author_id !== undefined ? { authorId: wire.author_id } : {}),
    ...(wire.author !== undefined ? { author: normaliseApplicationAuthor(wire.author) } : {}),
  };
}

export function normaliseApplicationVersionDetail(
  wire: ApplicationVersionDetailWire,
): ApplicationVersionDetail {
  return {
    id: wire.id,
    applicationId: wire.application_id,
    name: wire.name,
    status: wire.status,
    ...normaliseApplicationVersionDetailScalars(wire),
    ...normaliseApplicationVersionDetailPassthroughs(wire),
    ...normaliseApplicationVersionDetailAuthorFields(wire),
  };
}

/**
 * `ApplicationDetail` (v2.yaml:661-682; shared/api/generated/model/
 * applicationDetail.zod.ts) — the Get response map.
 */
export interface ApplicationDetailWire {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly owner_id: string;
  readonly created_at: string;
  readonly versions: readonly ApplicationVersionSummaryWire[];
  readonly version_details?: ApplicationVersionDetailWire;
}

export function normaliseApplicationDetail(wire: ApplicationDetailWire): ApplicationDetail {
  return {
    id: wire.id,
    name: wire.name,
    description: wire.description,
    icon: wire.icon,
    ownerId: wire.owner_id,
    createdAt: wire.created_at,
    versions: wire.versions.map(normaliseApplicationVersionSummary),
    ...(wire.version_details !== undefined
      ? { versionDetails: normaliseApplicationVersionDetail(wire.version_details) }
      : {}),
  };
}

/**
 * `ApplicationCreatedResponse` (v2.yaml:684-704; shared/api/generated/model/
 * applicationCreatedResponse.zod.ts) — the Create response map.
 * `version_details`/`versions` (a single-element echo of `version_details`)
 * appear only when the request carried a `versions` array (v2.yaml:374-463).
 */
export interface ApplicationCreatedResponseWire {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly icon: string;
  readonly owner_id: string;
  readonly created_at: string;
  readonly version_details?: ApplicationVersionDetailWire;
  readonly versions?: readonly ApplicationVersionDetailWire[];
}

export function normaliseApplicationCreatedResponse(
  wire: ApplicationCreatedResponseWire,
): ApplicationCreatedResponse {
  return {
    id: wire.id,
    name: wire.name,
    description: wire.description,
    type: wire.type,
    icon: wire.icon,
    ownerId: wire.owner_id,
    createdAt: wire.created_at,
    ...(wire.version_details !== undefined
      ? { versionDetails: normaliseApplicationVersionDetail(wire.version_details) }
      : {}),
    ...(wire.versions !== undefined
      ? { versions: wire.versions.map(normaliseApplicationVersionDetail) }
      : {}),
  };
}

/**
 * `ApplicationUpdatedResponse` (v2.yaml:706-720; shared/api/generated/model/
 * applicationUpdatedResponse.zod.ts) — the Update response map.
 */
export interface ApplicationUpdatedResponseWire {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly owner_id: string;
  readonly created_at: string;
  readonly version_details?: ApplicationVersionDetailWire;
}

export function normaliseApplicationUpdatedResponse(
  wire: ApplicationUpdatedResponseWire,
): ApplicationUpdatedResponse {
  return {
    id: wire.id,
    name: wire.name,
    description: wire.description,
    icon: wire.icon,
    ownerId: wire.owner_id,
    createdAt: wire.created_at,
    ...(wire.version_details !== undefined
      ? { versionDetails: normaliseApplicationVersionDetail(wire.version_details) }
      : {}),
  };
}
