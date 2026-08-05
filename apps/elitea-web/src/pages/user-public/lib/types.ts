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
/**
 * Which of ROUTE-041's four entity domains an item is — added for the
 * A12-ui adversarial-review fix (`EntityListPanel`'s cards were fully
 * inert, no way to reach an item's own detail page). `AllStuffPanel` merges
 * agents and pipelines into one list (`lib/merge-and-sort.ts`), so a single
 * list item's own kind has to travel WITH it for the composition root to
 * know which of the four `/user-public/{agents,pipelines,toolkits,mcps}/$id`
 * routes (`src/routes/_shell/user-public/*.tsx`, ROUTE-042..045) to send a
 * click to. `'toolkit'`/`'MCP'` are part of the union for completeness (the
 * type every panel reads is shared) even though no mapper in this unit
 * produces them yet — see `UnavailablePanel`'s doc for why those two tabs
 * have no data source.
 */
type EntityKind = 'agent' | 'pipeline' | 'toolkit' | 'MCP';

export interface UserPublicListItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: string | undefined;
  readonly authorNames: readonly string[];
  readonly createdAt: string;
  readonly kind: EntityKind;
}
