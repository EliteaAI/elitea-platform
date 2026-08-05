import type {
  ApplicationVersionDetail,
  ApplicationVersionSummary,
  VersionMeta as VersionMetaWire,
  VersionTag as VersionTagWire,
  VersionToolRef as VersionToolRefWire,
  VersionVariable as VersionVariableWire,
} from '@/shared/api/generated/model';

import type { Version, VersionMeta, VersionSummary, VersionTag, VersionToolRef, VersionVariable } from '../model/types';

/**
 * `versionVariable.zod.ts`'s `.nullish()` fields type as `T | null |
 * undefined` on BOTH keys (not merely optional-key sugar) — under this
 * project's `exactOptionalPropertyTypes`, that is not directly assignable
 * to the domain `VersionVariable` (`name?`/`value?` may not hold an
 * explicit `undefined`), even though the two interfaces read as identical
 * at a glance. This re-keys each entry so an explicit wire `undefined`
 * becomes an absent domain key.
 */
function normaliseVersionVariable(wire: VersionVariableWire): VersionVariable {
  return {
    ...(wire.name !== undefined ? { name: wire.name } : {}),
    ...(wire.value !== undefined ? { value: wire.value } : {}),
  };
}

/**
 * `VersionMeta.attachment_storage` -> `VersionMeta.attachmentStorage`
 * (v2.yaml, `versionMeta.zod.ts`: `attachment_storage: {toolkit_id}` written
 * by `UpdateAttachmentStorage`, eliteacore/handler.go:1777-1781). Keys are
 * only added when present so an absent wire key stays ABSENT on the domain
 * object, matching the `entities/canvas` optional-field spread convention.
 */
function normaliseVersionMeta(wire: VersionMetaWire): VersionMeta {
  return {
    ...(wire.step_limit !== undefined ? { stepLimit: wire.step_limit } : {}),
    ...(wire.icon_meta !== undefined ? { iconMeta: wire.icon_meta } : {}),
    ...(wire.category !== undefined ? { category: wire.category } : {}),
    ...(wire.source_version_id !== undefined ? { sourceVersionId: wire.source_version_id } : {}),
    ...(wire.parent_entity_id !== undefined ? { parentEntityId: wire.parent_entity_id } : {}),
    ...(wire.parent_project_id !== undefined ? { parentProjectId: wire.parent_project_id } : {}),
    ...(wire.parent_author_id !== undefined ? { parentAuthorId: wire.parent_author_id } : {}),
    ...(wire.variables !== undefined ? { variables: wire.variables.map(normaliseVersionVariable) } : {}),
    ...(wire.attachment_storage !== undefined
      ? {
          attachmentStorage:
            wire.attachment_storage.toolkit_id !== undefined
              ? { toolkitId: wire.attachment_storage.toolkit_id }
              : {},
        }
      : {}),
  };
}

/**
 * `VersionToolRef` merges two DB row shapes (NOTE(W2), `versionToolRef.zod.ts`,
 * v2.yaml:562-572): only `id`/`config`/`settings` need no renaming, the rest
 * (`tool_id`, `entity_type`, `selected_tools`, `author_id`, `project_id`) are
 * snake_case -> camelCase. Every field but `id` is genuinely optional on
 * both row shapes, so absent keys stay absent rather than becoming `undefined`.
 */
function normaliseVersionToolRef(wire: VersionToolRefWire): VersionToolRef {
  return {
    id: wire.id,
    ...(wire.tool_id !== undefined ? { toolId: wire.tool_id } : {}),
    ...(wire.entity_type !== undefined ? { entityType: wire.entity_type } : {}),
    ...(wire.selected_tools !== undefined ? { selectedTools: wire.selected_tools } : {}),
    ...(wire.name !== undefined ? { name: wire.name } : {}),
    ...(wire.type !== undefined ? { type: wire.type } : {}),
    ...(wire.config !== undefined ? { config: wire.config } : {}),
    ...(wire.settings !== undefined ? { settings: wire.settings } : {}),
    ...(wire.author_id !== undefined ? { authorId: wire.author_id } : {}),
    ...(wire.project_id !== undefined ? { projectId: wire.project_id } : {}),
  };
}

/**
 * `versionTag.zod.ts` declares `name` as `nullish` (optional AND nullable —
 * Fork's unvalidated echo can omit the key entirely, eliteacore/handler.go:
 * 2431-2438), but the domain `VersionTag.name` is a REQUIRED key (nullable
 * value). An absent wire `name` is functionally the same "unnamed tag" case
 * as an explicit `null`, so both collapse to a present `name: null`.
 */
function normaliseVersionTag(wire: VersionTagWire): VersionTag {
  return {
    name: wire.name ?? null,
    ...(wire.data !== undefined ? { data: wire.data } : {}),
  };
}

/** `Version`'s scalar/primitive optional fields — everything but `meta`, `author`/`authorId`, and the three array fields. */
function versionScalarFields(
  wire: ApplicationVersionDetail,
): Partial<Pick<Version, 'createdAt' | 'agentType' | 'instructions' | 'welcomeMessage' | 'isForked'>> {
  return {
    ...(wire.created_at !== undefined ? { createdAt: wire.created_at } : {}),
    ...(wire.agent_type !== undefined ? { agentType: wire.agent_type } : {}),
    ...(wire.instructions !== undefined ? { instructions: wire.instructions } : {}),
    ...(wire.welcome_message !== undefined ? { welcomeMessage: wire.welcome_message } : {}),
    ...(wire.is_forked !== undefined ? { isForked: wire.is_forked } : {}),
  };
}

/** `Version`'s opaque DB-jsonb passthrough fields — never reshaped, only presence-gated. */
function versionOpaqueFields(
  wire: ApplicationVersionDetail,
): Partial<Pick<Version, 'llmSettings' | 'conversationStarters' | 'pipelineSettings'>> {
  return {
    ...(wire.llm_settings !== undefined ? { llmSettings: wire.llm_settings } : {}),
    ...(wire.conversation_starters !== undefined ? { conversationStarters: wire.conversation_starters } : {}),
    ...(wire.pipeline_settings !== undefined ? { pipelineSettings: wire.pipeline_settings } : {}),
  };
}

/**
 * `author`/`author_id` — SIBLING optional fields populated on DISJOINT
 * endpoints (NOTE(W2), v2.yaml:643-656; `types.test.ts`'s
 * `Version.author` describe block). Copied independently, never inferring
 * one from the other.
 */
function versionAuthorFields(wire: ApplicationVersionDetail): Partial<Pick<Version, 'authorId' | 'author'>> {
  return {
    ...(wire.author_id !== undefined ? { authorId: wire.author_id } : {}),
    ...(wire.author !== undefined ? { author: wire.author } : {}),
  };
}

/** `Version`'s three item-normalised array fields. */
function versionCollectionFields(
  wire: ApplicationVersionDetail,
): Partial<Pick<Version, 'tools' | 'tags' | 'variables'>> {
  return {
    ...(wire.tools !== undefined ? { tools: wire.tools.map(normaliseVersionToolRef) } : {}),
    ...(wire.tags !== undefined ? { tags: wire.tags.map(normaliseVersionTag) } : {}),
    ...(wire.variables !== undefined ? { variables: wire.variables.map(normaliseVersionVariable) } : {}),
  };
}

/** `meta` is optional AND nullable (v2.yaml `VersionMeta.nullish()`) — an explicit wire `null` stays `null`. */
function versionMetaField(wire: ApplicationVersionDetail): Partial<Pick<Version, 'meta'>> {
  if (wire.meta === undefined) return {};
  return { meta: wire.meta === null ? null : normaliseVersionMeta(wire.meta) };
}

/**
 * Wire -> domain for `Version`. Source: `ApplicationVersionDetail`
 * (`applicationVersionDetail.zod.ts`, v2.yaml:324-334,363-660, unit W2) —
 * the union-shaped detail map `fetchVersionDetails`/`CreateVersion`/
 * `UpdateVersion`/`Fork` each populate a different subset of. Every field
 * beyond the four common ones (`id`, `application_id`, `name`, `status`) is
 * optional on the wire schema and copied only when present (split across the
 * `version*Fields` helpers above to keep this function's own complexity low),
 * so this normaliser is honest about field presence for whichever endpoint
 * produced `wire` rather than defaulting or inventing values — see
 * `normalise.test.ts` for the disjoint `author`/`author_id` (CreateVersion vs
 * fetchVersionDetails) and `is_forked: false` (must not default/drop) cases
 * this is evidenced against.
 */
export function normaliseVersion(wire: ApplicationVersionDetail): Version {
  return {
    id: wire.id,
    applicationId: wire.application_id,
    name: wire.name,
    status: wire.status,
    ...versionScalarFields(wire),
    ...versionOpaqueFields(wire),
    ...versionMetaField(wire),
    ...versionAuthorFields(wire),
    ...versionCollectionFields(wire),
  };
}

/**
 * Wire -> domain for `VersionSummary` — the `getVersions` row map
 * (`applicationVersionSummary.zod.ts`: "NOTE(W2): getVersions row map,
 * internal/api/v2/applications/handler.go:159-165") also embedded verbatim
 * as `ApplicationDetail.versions[]` (`applicationDetail.zod.ts:51`), the
 * source `selectDefaultVersion`/`sortVersionsForPicker` operate on. Unlike
 * `ApplicationVersionDetail`, every field here is required on the wire, so
 * this is a plain snake_case -> camelCase rename with no presence handling.
 */
export function normaliseVersionSummary(wire: ApplicationVersionSummary): VersionSummary {
  return {
    id: wire.id,
    name: wire.name,
    status: wire.status,
    agentType: wire.agent_type,
    createdAt: wire.created_at,
  };
}

export function normaliseVersionSummaries(wire: readonly ApplicationVersionSummary[]): VersionSummary[] {
  return wire.map(normaliseVersionSummary);
}

/**
 * NOTE(W2), v2.yaml:381-386,395-410: `variables` can be written into
 * `application_versions.meta.variables` on create AND separately echoed at
 * the top level (`Version.variables`) — the two are not guaranteed to
 * agree, and the top-level array is the one later reads use
 * (applications/handler.go:325-342). This normaliser applies that
 * precedence explicitly rather than leaving call sites to guess which
 * source wins, and drops entries whose `name` is `null` (an unusable,
 * unaddressable variable per v2.yaml:583-591's echo-path caveat).
 */
export function resolveVersionVariables(
  version: Pick<Version, 'variables' | 'meta'>,
): Array<{ readonly name: string; readonly value: string | null }> {
  const source = version.variables ?? version.meta?.variables ?? [];
  return source.filter(
    (variable): variable is { readonly name: string; readonly value: string | null } => variable.name !== null,
  );
}

/**
 * Drops tag entries with a `null` name — v2.yaml:604-609: Fork's
 * unvalidated echo can produce `{"name": null, ...}` for a fork payload tag
 * without a name; such an entry cannot be displayed or matched by name.
 */
export function resolveVersionTags(tags: readonly VersionTag[]): Array<{ readonly name: string; readonly data?: unknown }> {
  return tags
    .filter((tag): tag is VersionTag & { readonly name: string } => tag.name !== null)
    .map((tag) => (tag.data !== undefined ? { name: tag.name, data: tag.data } : { name: tag.name }));
}
