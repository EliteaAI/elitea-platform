/**
 * Local, normalized shape every panel in this slice renders — deliberately
 * NOT `entities/application`'s `Application` type. That entity type uses
 * camelCase field names (`ownerId`, `createdAt`, `agentType` —
 * `src/entities/application/model/types.ts:49-72`) that do not match the
 * generated wire type of the same name (`src/shared/api/generated/model/application.zod.ts`,
 * snake_case: `owner_id`, `created_at`, `agent_type`) — and, having read
 * every `model/` directory under `src/entities/`, none of the 23 entity slices ships
 * a normalizer converting the generated wire shape into its own entity
 * shape (spec §3.2 lists "types, normalisers, pure selectors" as the
 * entities layer's job; only types + selectors landed). Reaching into
 * `entities/application` here would mean either silently mismatching field
 * names or hand-writing the very normalizer that layer is supposed to own —
 * outside this unit's ownership fence. Flagged prominently in the A12
 * report. This local, minimal type sidesteps the gap entirely for this
 * page's own rendering needs.
 */
export interface UserPublicListItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: string | undefined;
  readonly authorNames: readonly string[];
  readonly createdAt: string;
}
