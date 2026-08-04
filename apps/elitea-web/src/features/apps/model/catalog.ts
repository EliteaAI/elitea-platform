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
 *
 * **`canRequest` deliberately does NOT mirror the baseline hook's own
 * `canRequest: !canCreate && !isConfigured` (`useApplicationCatalogState.
 * hooks.js:83`) — that field is dead in the baseline's real UI.** The
 * baseline's actual render path, `ApplicationCatalog.jsx:55`, computes its
 * OWN local `canRequest = !application.canCreate && requestStatus !==
 * REQUEST_STATUS.PENDING` and passes THAT to `ApplicationCatalogCard`,
 * shadowing (never reading) the hook's `application.canRequest` entirely.
 * So an already-configured-but-not-self-serve-creatable entry
 * (`isConfigured: true`, `canCreate: false`) still gets a real "Request
 * Access" button in the baseline app, even though its own hook's dead field
 * says `false`. This port's `ApplicationCatalogCard.tsx` has no such
 * per-render shadow — it reads `application.canRequest` directly
 * (`canRequest = application.canRequest && !isPending`) — so THIS field
 * must encode the baseline's real (`ApplicationCatalog.jsx`) formula, not
 * its unused hook one, or the port loses the button the old app actually
 * shows. `isConfigured` is intentionally excluded from the expression below
 * for that reason (kept as its own separate field for `availability`/badge
 * use, per `ApplicationAvailability`'s own doc comment).
 *
 * **Out-of-scope follow-up for whoever owns `ui/catalog/
 * ApplicationCatalogCard.tsx`:** that file's own test,
 * `ApplicationCatalogCard.test.tsx`'s `'shows neither action when the type
 * is already configured'` (built with `catalogApp({ configured: true })`,
 * i.e. `canCreate: false`/`isConfigured: true`), asserted the PRE-FIX
 * (buggy) behaviour — it expects no "Request Access" button, but the
 * correct/real behaviour (see above) is that one renders. That assertion
 * needs updating to `expect(screen.getByRole('button', { name: 'Request
 * Access' })).toBeInTheDocument()` (Configure still correctly absent) once
 * this fix lands; left unedited here since that file is outside this
 * cluster's own scope.
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
    // NOT `entry.description` — mirrors the baseline hook's own field
    // overwrite (`useApplicationCatalogState.hooks.js:66`, `description:
    // application.shortDescription`). Baseline's catalogue data ALSO
    // carries a distinct, longer `description` string per entry
    // (`applicationCatalog.constants.js`), but that hook clobbers it with
    // `shortDescription` before the object ever reaches
    // `ApplicationCatalogCard`, whose title tooltip reads
    // `application.description` (`ApplicationCatalogCard.jsx:81`) — so the
    // long-form copy was NEVER actually rendered anywhere in the shipped
    // baseline app; it sat unused in the constants module. This port's own
    // `ApplicationCatalogCard.tsx` also reads `application.description` for
    // that same tooltip, unchanged from baseline, so `description` must be
    // populated with the short blurb here for tooltip-content parity — using
    // `entry.description` instead is a regression (the card would show
    // richer copy the baseline user never saw). `entry.description` itself
    // is intentionally left unused, exactly as in the baseline.
    description: entry.shortDescription,
    capabilities: entry.capabilities,
    bestFor: entry.bestFor,
    documentation: entry.documentation,
    typeLabel: schemaLabel(schema, entry.name),
    canCreate,
    isConfigured,
    canRequest: !canCreate,
    availability: resolveApplicationAvailability(isConfigured, canCreate),
  };
}
