import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';

import type { ApplicationCatalogEntry } from '../lib/constants';

import type { ApplicationAvailability, CatalogApplication } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `schema.metadata.application === true` narrows the toolkit-type schema
 * catalogue down to types the App Catalog cares about — ported from
 * `useApplicationCatalogState.hooks.js:32-38`. Every OTHER toolkit type
 * (github, jira, mcp, ...) is filtered out here, same as the baseline.
 */
function isApplicationSchema(schema: unknown): schema is Record<string, unknown> {
  if (!isRecord(schema)) return false;
  const metadata = schema.metadata;
  return isRecord(metadata) && metadata.application === true;
}

/**
 * Ported from `useApplicationCatalogState.hooks.js:31-39`. Accepts
 * `Record<string, unknown>` (not the more specific `ToolkitTypeSchemaMap`)
 * because the caller's `toolkitTypeSchemas` is itself only a TYPE
 * ASSERTION over an un-validated network response (see
 * `useToolkitTypeSchemas.ts`'s doc comment) — `isApplicationSchema` below
 * is the real runtime guard for whatever shape actually arrives.
 */
export function filterApplicationSchemas(schemas: Record<string, unknown> | undefined): ToolkitTypeSchemaMap {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [type, schema] of Object.entries(schemas ?? {})) {
    if (isApplicationSchema(schema)) result[type] = schema;
  }
  return result;
}

/**
 * Replaces the baseline's `getApplicationStatusLabel`
 * (`useApplicationCatalogState.hooks.js:14-19`) — returns a discriminant,
 * not a translated label; see `model/types.ts`'s `ApplicationAvailability`
 * doc for why translation moved to the `ui/` call site.
 */
export function resolveApplicationAvailability(isConfigured: boolean, canCreate: boolean): ApplicationAvailability {
  if (isConfigured) return 'configured';
  if (canCreate) return 'available';
  return 'byRequest';
}

function schemaLabel(schema: Record<string, unknown> | undefined, fallback: string): string {
  const metadata = schema?.metadata;
  if (isRecord(metadata) && typeof metadata.label === 'string' && metadata.label.length > 0) {
    return metadata.label;
  }
  return fallback;
}

/**
 * Ported from `useApplicationCatalogState.hooks.js:46-89`'s per-entry
 * `.map()` body (the icon-element construction and the `author`/`tags`
 * fields it also built are dropped here: they were baseline artifacts of
 * feeding `ApplicationCatalogCard` through the same generic entity-card
 * shape `ToolkitsList` uses — this port's `ApplicationCatalogCard` is its
 * own component and reads `Icon`/`typeLabel`/`availability` directly).
 */
export function buildCatalogApplication(
  entry: ApplicationCatalogEntry,
  applicationSchemas: ToolkitTypeSchemaMap,
  configuredTypes: ReadonlySet<string>,
): CatalogApplication {
  const rawSchema = applicationSchemas[entry.type];
  const schema = isRecord(rawSchema) ? rawSchema : undefined;
  const canCreate = schema !== undefined;
  const isConfigured = configuredTypes.has(entry.type);

  return {
    type: entry.type,
    name: entry.name,
    Icon: entry.Icon,
    shortDescription: entry.shortDescription,
    description: entry.description,
    capabilities: entry.capabilities,
    bestFor: entry.bestFor,
    documentation: entry.documentation,
    typeLabel: schemaLabel(schema, entry.name),
    canCreate,
    isConfigured,
    canRequest: !canCreate && !isConfigured,
    availability: resolveApplicationAvailability(isConfigured, canCreate),
  };
}
