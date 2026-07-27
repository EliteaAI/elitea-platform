import type {
  App,
  AppDetail,
  AppDetailWire,
  AppPage,
  AppPageWire,
  AppVersionDetail,
  AppVersionDetailWire,
  AppWire,
} from '../model/types';

/**
 * snake_case wire shape -> camelCase `App` domain type
 * (`PublicApplicationSummary`, NOTE(W2):
 * internal/api/v2/eliteacore/handler.go:1303-1312). `meta` is passed
 * through unchanged — both `AppWire.meta` and `App.meta` are the same
 * opaque `Record<string, unknown> | null` shape, see `AppWire`'s doc
 * comment. `likes`/`isLiked` are deliberately never set here — they are
 * client-only fields (apps/elitea-ui/src/hooks/useCardLike.js:69-122) that
 * do not exist on the wire.
 */
export function normaliseApp(wire: AppWire): App {
  return {
    projectId: wire.project_id,
    id: wire.id,
    name: wire.name,
    description: wire.description,
    versionId: wire.version_id,
    versionName: wire.version_name,
    agentType: wire.agent_type,
    meta: wire.meta,
  };
}

export function normaliseApps(wire: readonly AppWire[]): App[] {
  return wire.map(normaliseApp);
}

/** `PublicApplicationList` envelope (`rows`+`total`) -> `AppPage`. */
export function normaliseAppPage(wire: AppPageWire): AppPage {
  return {
    rows: normaliseApps(wire.rows),
    total: wire.total,
  };
}

/**
 * The `id`/`applicationId`/`name`/`status`/`createdAt`/`agentType`/
 * `instructions`/`welcomeMessage` slice of `normaliseAppVersionDetail`,
 * split out to keep each function's branch count under the lint
 * complexity budget — see `normaliseAppVersionDetail`'s doc comment for
 * the "absent stays absent" rationale shared by all three slices.
 */
function coreVersionDetailFields(
  wire: AppVersionDetailWire,
): Pick<AppVersionDetail, 'id' | 'applicationId' | 'name' | 'status'> &
  Partial<Pick<AppVersionDetail, 'createdAt' | 'agentType' | 'instructions' | 'welcomeMessage'>> {
  return {
    id: wire.id,
    applicationId: wire.application_id,
    name: wire.name,
    status: wire.status,
    ...(wire.created_at !== undefined ? { createdAt: wire.created_at } : {}),
    ...(wire.agent_type !== undefined ? { agentType: wire.agent_type } : {}),
    ...(wire.instructions !== undefined ? { instructions: wire.instructions } : {}),
    ...(wire.welcome_message !== undefined ? { welcomeMessage: wire.welcome_message } : {}),
  };
}

/** The `llmSettings`/`meta`/`conversationStarters`/`pipelineSettings` slice. */
function contentVersionDetailFields(
  wire: AppVersionDetailWire,
): Partial<Pick<AppVersionDetail, 'llmSettings' | 'meta' | 'conversationStarters' | 'pipelineSettings'>> {
  return {
    ...(wire.llm_settings !== undefined ? { llmSettings: wire.llm_settings } : {}),
    ...(wire.meta !== undefined ? { meta: wire.meta } : {}),
    ...(wire.conversation_starters !== undefined ? { conversationStarters: wire.conversation_starters } : {}),
    ...(wire.pipeline_settings !== undefined ? { pipelineSettings: wire.pipeline_settings } : {}),
  };
}

/**
 * The `authorId`/`author`/`tools`/`tags`/`variables`/`isForked` slice —
 * exactly the fields NOTE(W2) (eliteacore/handler.go:1460-1475) says
 * `publicApplicationDetail` never sends, plus `tools`/`tags` which it does.
 */
function authorshipVersionDetailFields(
  wire: AppVersionDetailWire,
): Partial<Pick<AppVersionDetail, 'authorId' | 'author' | 'tools' | 'tags' | 'variables' | 'isForked'>> {
  return {
    ...(wire.author_id !== undefined ? { authorId: wire.author_id } : {}),
    ...(wire.author !== undefined ? { author: wire.author } : {}),
    ...(wire.tools !== undefined ? { tools: wire.tools } : {}),
    ...(wire.tags !== undefined ? { tags: wire.tags } : {}),
    ...(wire.variables !== undefined ? { variables: wire.variables } : {}),
    ...(wire.is_forked !== undefined ? { isForked: wire.is_forked } : {}),
  };
}

/**
 * `ApplicationVersionDetail` (embedded in `PublicApplicationDetail.
 * version_details`) -> `AppVersionDetail`. Every field past the required
 * four uses the "absent stays absent" spread pattern
 * (entities/canvas/lib/normalise.ts precedent) instead of defaulting,
 * because `publicApplicationDetail` genuinely omits `variables`,
 * `created_at`, `author` and `is_forked` on the wire (NOTE(W2),
 * eliteacore/handler.go:1460-1475, see `AppVersionDetailWire`'s doc
 * comment) — coalescing them to `[]`/`undefined`-as-present-key would
 * misrepresent "the server never sends this" as "the server sent an empty
 * value". Field-mapping itself is split across three small helpers purely
 * to stay under the lint complexity budget (branch count), not for any
 * semantic reason — see `normalise.test.ts` for the full merged-output
 * assertions.
 */
export function normaliseAppVersionDetail(wire: AppVersionDetailWire): AppVersionDetail {
  return {
    ...coreVersionDetailFields(wire),
    ...contentVersionDetailFields(wire),
    ...authorshipVersionDetailFields(wire),
  };
}

/** `PublicApplicationDetail` -> `AppDetail`. */
export function normaliseAppDetail(wire: AppDetailWire): AppDetail {
  return {
    id: wire.id,
    name: wire.name,
    description: wire.description,
    versionDetails: normaliseAppVersionDetail(wire.version_details),
  };
}
