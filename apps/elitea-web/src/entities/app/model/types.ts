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
 * Wire shape (snake_case) of `PublicApplicationSummary`, mirroring
 * `shared/api/generated/model/publicApplicationSummary.zod.ts` (NOTE(W2):
 * internal/api/v2/eliteacore/handler.go:1303-1312). Kept alongside `App` so
 * `lib/normalise.ts`'s input type is evidenced, not `any`. `meta` is typed
 * identically to `App.meta` (opaque passthrough) — its wire shape is the
 * structured, snake_case `VersionMeta` schema, but neither this type nor
 * `App` ever inspects its sub-fields, so `lib/normalise.ts` passes it
 * through unchanged rather than reshaping it.
 */
export interface AppWire {
  readonly project_id: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version_id: string;
  readonly version_name: string;
  readonly agent_type: string;
  readonly meta: Readonly<Record<string, unknown>> | null;
}

/** Wire shape of `PublicApplicationList` — the `rows`+`total` list envelope. */
export interface AppPageWire {
  readonly rows: readonly AppWire[];
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
 * Wire shape (snake_case) of `ApplicationVersionDetail` as embedded in
 * `PublicApplicationDetail.version_details`, mirroring
 * `shared/api/generated/model/applicationVersionDetail.zod.ts`. Every field
 * below `status` is optional on the wire (NOTE(W2), same source cited on
 * `AppVersionDetail`) — this type is a straight snake_case mirror of that
 * one, field-for-field, so `lib/normalise.ts` can map it 1:1 without
 * inventing or dropping fields. On the `publicApplicationDetail` path
 * specifically, `variables`, `created_at`, `author` and `is_forked` are
 * never sent (eliteacore/handler.go:1460-1475) — they're absent, not
 * `null`, so the optional (`?`) modifier — not a nullable union — is the
 * correct way to model that.
 */
export interface AppVersionDetailWire {
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
  readonly author?: { readonly id: string; readonly email: string; readonly name: string };
  readonly tools?: readonly unknown[];
  readonly tags?: readonly unknown[];
  readonly variables?: readonly { readonly name?: string | null; readonly value?: string | null }[];
  readonly is_forked?: boolean;
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

/** Wire shape of `PublicApplicationDetail` (v2.yaml:1107-1119). */
export interface AppDetailWire {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version_details: AppVersionDetailWire;
}
