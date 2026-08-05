/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/helpers/
 * toolkits.helpers.js:127-134` (`cleanString`) and `:251-267`
 * (`genToolkitName`) — pure functions, no hooks.
 *
 * Duplicated locally rather than imported from `features/toolkits`: unit A4
 * has not landed in this worktree, and even once it does, `no-sideways-
 * features` forbids `features/agents` importing it (this batch's brief,
 * absolute, no carve-out). Distinct from `entities/toolkit`'s promoted
 * `toolkitDisplayName` — that selector operates on a full `Toolkit` catalogue
 * record and has a different fallback chain (no schema-`toolkit_name`-field
 * lookup, ends in a capitalized-type fallback `genToolkitName` does not
 * have); this is a byte-for-byte port of the baseline's OWN, different
 * function, kept separate rather than reconciled into one shape it never had
 * in the baseline.
 */
import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';

/**
 * Structural (not `AgentToolRef`/`AgentToolAssociation`-nominal) — this
 * function is called with both this slice's own `AgentToolRef`
 * (`../model/types.ts`) and sibling A1h's `AgentToolAssociation`
 * (`../lib/types.ts`, `ApplicationTools.tsx`'s direct child `ToolCard`'s own
 * shape) depending on caller; only these three fields are ever read.
 */
interface GenToolkitNameInput {
  readonly type?: string | undefined;
  readonly name?: string | undefined;
  /** `unknown`, not `Record<string, unknown>`: callers pass concrete, index-signature-free interfaces (`AgentToolAssociation['settings']`) that don't structurally satisfy an index signature; read via a local cast below instead. */
  readonly settings?: unknown;
}

/**
 * `toolkits.helpers.js:127-134`. Strips everything but alphanumerics,
 * underscore and hyphen, then folds `.` into `_`.
 */
export function cleanString(value: string | undefined, maxLength = 0): string {
  if (typeof value !== 'string') return '';
  const pattern = /[^a-zA-Z0-9_.-]/g;
  const result = value.replace(pattern, '').replaceAll('.', '_');
  return maxLength > 0 ? result.slice(0, maxLength) : result;
}

interface SchemaProperty {
  readonly toolkit_name?: boolean;
}

interface ToolkitSchemaShape {
  readonly properties?: Readonly<Record<string, SchemaProperty>>;
}

/**
 * `toolkits.helpers.js:251-267`. Looks up the schema property (if any)
 * flagged `toolkit_name` for this tool's type; if that property has a
 * non-blank value on the tool's own `settings`, that wins. Otherwise falls
 * back to `name` -> `settings.elitea_title` -> `settings.configuration_title`
 * -> `''`.
 */
export function genToolkitName(tool: GenToolkitNameInput, schemaOfTools: ToolkitTypeSchemaMap | undefined): string {
  const schema = (tool.type !== undefined ? (schemaOfTools?.[tool.type] as ToolkitSchemaShape | undefined) : undefined) ?? {};
  const propertyEntry = Object.entries(schema.properties ?? {}).find(([, value]) => value.toolkit_name);
  const key = propertyEntry?.[0];

  const settings = (tool.settings ?? {}) as Readonly<Record<string, unknown>>;

  // `||`, not `??` — the baseline (`toolkit.name || toolkit.settings?.elitea_title || ...`)
  // treats a BLANK name (`''`), not just `undefined`/`null`, as "absent" and falls through.
  const fallback = cleanString(
    tool.name || (settings['elitea_title'] as string | undefined) || (settings['configuration_title'] as string | undefined) || '',
  );

  if (key === undefined) return fallback;

  const keyedValue = cleanString(settings[key] as string | undefined);
  return keyedValue || fallback;
}
