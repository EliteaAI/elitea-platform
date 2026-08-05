/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/helpers/
 * legacyOpenApiMigration.helpers.js` (97 lines, Wave-2 unit A4b).
 *
 * SCHEDULED DEBT, PORTED ANYWAY: the baseline file's own header is literally
 * `TODO: DELETE THIS ENTIRE FILE after migration period (Q1 2026)` — it
 * normalises an OLD-format OpenAPI toolkit (inline `authentication` +
 * `schema_settings`) to the NEW format (`spec` + an `openapi_configuration`
 * reference) for UI rendering only, never persisting the change. The
 * mission brief for this sub-unit is explicit that this file stays in scope
 * despite the TODO: `EditToolkit`/`CreateToolkit`/`ToolkitEditor` (owned by
 * sibling A4 sub-units) all call it, so dropping it would silently break
 * every legacy-toolkit edit flow. Kept as a faithful port; whichever unit
 * eventually deletes the baseline file post-migration should delete this
 * one too.
 */

/** Old-format `authentication` block — shape only matters for its presence, its fields are intentionally dropped below. */
interface LegacyToolkitAuthentication {
  readonly type?: string;
  readonly settings?: Readonly<Record<string, unknown>>;
}

/** A `selected_tools` entry in either the old (object-with-`name`) or new (bare string) shape. */
type LegacySelectedTool = string | { readonly name?: string } | null | undefined;

/** Not exported: no current caller needs the settings shape apart from `LegacyOpenApiToolkitLike` below (which is exported and consumed elsewhere). */
interface LegacyOpenApiToolkitSettings {
  readonly schema_settings?: string;
  readonly authentication?: LegacyToolkitAuthentication;
  readonly selected_tools?: readonly LegacySelectedTool[];
  readonly spec?: string;
  readonly [key: string]: unknown;
}

export interface LegacyOpenApiToolkitLike {
  readonly type?: string;
  readonly settings?: LegacyOpenApiToolkitSettings;
  readonly [key: string]: unknown;
}

export interface NormalisedOpenApiToolkitSettings {
  readonly spec: string;
  readonly selected_tools: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * `isLegacyOpenApiToolkit` — true when `toolkit.type === 'openapi'` AND its
 * `settings` still carries either the old `authentication` block or the old
 * `schema_settings` field (either is sufficient; the new format has
 * neither).
 */
export function isLegacyOpenApiToolkit(toolkit: LegacyOpenApiToolkitLike | undefined): boolean {
  if (toolkit?.type !== 'openapi') return false;
  const settings = toolkit.settings ?? {};
  return Boolean(settings.authentication) || Boolean(settings.schema_settings);
}

/** Extracts the `.name` from an object-shaped legacy tool entry, keeps a bare string as-is, drops anything else (null/undefined/other). */
function normaliseSelectedTool(tool: LegacySelectedTool): string | null {
  if (typeof tool === 'object' && tool !== null && typeof tool.name === 'string') return tool.name;
  if (typeof tool === 'string') return tool;
  return null;
}

/**
 * `normalizeLegacyOpenApiToolkit` — display-only normalisation, does NOT
 * persist. No-op (returns `toolkit` unchanged, by reference) when
 * `isLegacyOpenApiToolkit` is false. Otherwise: `schema_settings` -> `spec`
 * (falling back to any existing `spec` field, then `''`); `selected_tools`
 * normalised via `normaliseSelectedTool`; `authentication` is DROPPED —
 * the user must create/select a new `openapi_configuration` manually
 * (baseline's own comment, preserved: "Note: authentication is
 * intentionally dropped").
 */
export function normalizeLegacyOpenApiToolkit<T extends LegacyOpenApiToolkitLike>(
  toolkit: T,
): T | (Omit<T, 'settings'> & { readonly settings: NormalisedOpenApiToolkitSettings }) {
  if (!isLegacyOpenApiToolkit(toolkit)) return toolkit;

  const { settings = {}, ...rest } = toolkit;
  const { schema_settings, authentication: _authentication, selected_tools = [], ...restSettings } = settings;
  const existingSpec = restSettings['spec'];

  const normalizedSelectedTools = selected_tools
    .map(normaliseSelectedTool)
    .filter((tool): tool is string => tool !== null);

  return {
    ...rest,
    settings: {
      ...restSettings,
      spec: schema_settings || (typeof existingSpec === 'string' ? existingSpec : '') || '',
      selected_tools: normalizedSelectedTools,
    },
  };
}
