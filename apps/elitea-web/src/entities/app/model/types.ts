/**
 * App domain type — the published/marketplace-facing view of an
 * `entities/application` (Agent Hub). Mirrors OpenAPI schemas
 * `PublicApplicationSummary`, `PublicApplicationList`,
 * `PublicApplicationDetail` (services/elitea-main/api/openapi/v2.yaml:
 * 1076-1119, unit W2), sourced from
 * internal/api/v2/eliteacore/handler.go:1303-1312, 1477-1483.
 *
 * NOTE — naming ambiguity flagged by research: the old app's `/apps` route
 * (apps/elitea-ui/src/pages/apps/Apps.jsx) is a DIFFERENT concept — a
 * toolkit-type catalogue ("Applications" tab = agent/pipeline toolkits,
 * "App Catalog" tab = a static 2-item hard-coded list,
 * features/apps/lib/constants/applicationCatalog.constants.js:13-36) — not
 * this marketplace entity. This type models the schema-evidenced marketplace
 * "app" (Agent Hub / public_applications); the static catalogue has no
 * server-side entity and is out of scope for an entities/ type per the "no
 * placeholder types" rule.
 *
 * **`authors`/`author`/`tags` do NOT exist on this response and are
 * deliberately NOT modeled.** Verified directly against the live handler
 * that builds this exact row (internal/api/v2/eliteacore/handler.go:
 * 1290-1316): the SQL SELECT and the `map[string]any{...}` literal it
 * populates have EXACTLY 8 keys — project_id, id, name, description,
 * version_id, version_name, agent_type, meta — no author or tag data
 * anywhere. The old React client's `AgentCard.jsx:20-22`
 * (`const {authors=[], author={}} = application||{}`) and
 * `agentHub.helpers.js:85` (`tags: app.tags`) DO destructure these field
 * names, but against this handler they are always the destructuring
 * defaults (`author` even evaluates truthy as `{}`, so `cardAuthors`
 * resolves to `[{}]` and the tooltip text is always `''`) — dead/defensive
 * frontend code reading a shape the Go backend never sends, not evidence of
 * a real field. An earlier version of this file modeled them anyway,
 * uncited; this note (and the removed `appAuthors` selector, see
 * `model/selectors.ts`'s git history) is the correction.
 *
 * `VersionMeta`/`ApplicationVersionDetail` are declared inline rather than
 * imported from entities/version or entities/application, per the
 * dependency-cruiser `no-sideways-entities` rule.
 */

/** `App` summary row (`PublicApplicationSummary`). */
export interface App {
  /** Always the public project id. */
  readonly projectId: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly versionId: string;
  readonly versionName: string;
  readonly agentType: string;
  readonly meta: Readonly<Record<string, unknown>> | null;
  /** Client-only social fields — apps/elitea-ui/src/hooks/useCardLike.js:69-122. */
  readonly likes?: number;
  readonly isLiked?: boolean;
}

export interface AppPage {
  readonly rows: readonly App[];
  readonly total: number;
}

/**
 * Inline duplicate of `ApplicationVersionDetail` (v2.yaml:611-660) — see
 * entities/version's `Version`/`VersionAuthor` for the canonical, more
 * fully-commented definition; duplicated rather than imported per the
 * `no-sideways-entities` rule. `PublicApplicationDetail.version_details`
 * (v2.yaml:1107-1119) is the SAME schema `ApplicationVersionDetail` cited
 * for entities/version and entities/application.
 */
export interface AppVersionDetail {
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
  readonly author?: { readonly id: string; readonly email: string; readonly name: string };
  readonly tools?: readonly unknown[];
  readonly tags?: readonly unknown[];
  readonly variables?: readonly { readonly name?: string | null; readonly value?: string | null }[];
  readonly isForked?: boolean;
}

/**
 * `PublicApplicationDetail` (v2.yaml:1107-1119) — the single-app Get
 * response. NOTE(W2): `publicApplicationDetail` omits `variables`,
 * `created_at`, `author` and `is_forked` from its `version_details`
 * (eliteacore/handler.go:1460-1475).
 */
export interface AppDetail {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly versionDetails: AppVersionDetail;
}
