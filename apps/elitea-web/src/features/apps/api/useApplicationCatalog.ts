import { useMemo } from 'react';

import { useListApplications } from '@/shared/api/generated/applications/applications';
import type { Application, ApplicationList } from '@/shared/api/generated/model';

import { APPLICATION_CATALOG } from '../lib/constants';
import { buildCatalogApplication, filterApplicationSchemas } from '../model/catalog';
import type { CatalogApplication } from '../model/types';

import { useSelectedProjectId } from './useSelectedProjectId';
import { useToolkitTypeSchemas } from './useToolkitTypeSchemas';

/**
 * `isConfigured` source, replacing the baseline's `useListToolkitTypesQuery
 * ({ params: { application: true } })` (`useApplicationCatalogState.hooks.js:26-29`,
 * `api/toolkits.js:487-497` `toolkitTypes` RTK endpoint).
 *
 * **Backend-capability gap, documented rather than silently dropped:** that
 * baseline call hits the SAME URL as the schema catalogue
 * (`/elitea_core/toolkits/prompt_lib/{projectId}`), relying on the OLD
 * Python backend branching on the `application=true` query param to return
 * a DIFFERENT shape (a `{rows: string[]}` list of configured type keys)
 * than the bare schema-map call. The Go handler behind this route
 * (`internal/api/v2/toolkits/handler.go:231-233`, per the generated
 * client's own `NOTE(W2)`) is `ListTypeSchemas` — it always returns the
 * type→schema map, with no query-param-driven branch to a configured-types
 * list. That baseline call is therefore not portable at all against the Go
 * stack; there is no generated (or hand-registrable, per R-A5) endpoint
 * that answers "which toolkit types already have a configured instance in
 * this project" directly.
 *
 * `useListApplications` (`/elitea_core/applications/prompt_lib/{projectId}`,
 * unit S4/W2, `internal/api/v2/applications/handler.go:71-107`) is the
 * closest AVAILABLE substitute: every configured toolkit instance is an
 * `Application` row, and `ListApplicationsParams.agents_type` proves the
 * handler already filters on the same "type" concept this catalogue keys
 * on. Rather than firing one filtered request per catalogue entry (which
 * would call a generated `useX` hook inside a loop — a rules-of-hooks
 * violation for a variable-length array, even though this one happens to
 * be fixed at 2 today), this hook makes ONE unfiltered call and derives the
 * configured-type set client-side by checking both `type` and `agentType`
 * on every returned row (the OpenAPI schema does not pin down which of the
 * two field actually carries a toolkit-catalogue key like `"inventory"`,
 * and checking both is a safe superset, never a false negative either way).
 *
 * **Known limitation:** the Go handler's `ApplicationList` response is
 * paginated (`page`/`page_size`/`total_pages`) and this call requests no
 * explicit page size, so a project with more applications than the
 * backend's default page returns could have an already-configured type
 * missed if none of its instances land on that first page. Accepted here
 * as a bounded, non-crashing approximation — the alternative (a full,
 * paginated fetch-all) is disproportionate for a 2-item catalogue and is
 * not something this endpoint's shape makes cheap.
 */
function deriveConfiguredTypes(applicationList: ApplicationList | undefined): ReadonlySet<string> {
  const configured = new Set<string>();
  if (applicationList === undefined) return configured;
  for (const app of applicationList.rows as readonly Application[]) {
    // Wire field names are snake_case at this layer (the generated model
    // mirrors the Go JSON tags directly — `application.zod.ts`'s `type`/
    // `agent_type` — unlike `entities/application`'s camelCased
    // `Application.agentType`, which this hook does not use).
    if (typeof app.type === 'string') configured.add(app.type);
    if (typeof app.agent_type === 'string') configured.add(app.agent_type);
  }
  return configured;
}

/**
 * Replaces the baseline's `useApplicationCatalogState`
 * (`features/apps/lib/hooks/useApplicationCatalogState.hooks.js`).
 *
 * The baseline's own `theme.palette.icon.fill.default`-coloured
 * `icon_meta` element construction is dropped here — this port's
 * `ApplicationCatalogCard` renders `CatalogApplication.Icon` (the component
 * reference) directly with its own `sx`, so no icon-element needs building
 * in the hook (component vs. fetch separation, spec §3.6).
 */
export function useApplicationCatalog() {
  const projectId = useSelectedProjectId();
  const { toolkitTypeSchemas, isFetching: isFetchingSchemas } = useToolkitTypeSchemas(projectId);

  const applicationsQuery = useListApplications(
    projectId ?? '',
    undefined,
    { query: { enabled: projectId !== undefined } },
  );
  // `.data.data`'s declared type includes the error-envelope variant —
  // never actually reachable here since `eliteaFetch` throws instead of
  // resolving with it (mutator.ts's §3.6 unwrap contract).
  const applicationList = applicationsQuery.data?.data as ApplicationList | undefined;

  const applicationSchemas = useMemo(
    () => filterApplicationSchemas(toolkitTypeSchemas),
    [toolkitTypeSchemas],
  );
  const configuredTypes = useMemo(() => deriveConfiguredTypes(applicationList), [applicationList]);

  const applications: readonly CatalogApplication[] = useMemo(
    () => APPLICATION_CATALOG.map((entry) => buildCatalogApplication(entry, applicationSchemas, configuredTypes)),
    [applicationSchemas, configuredTypes],
  );

  return {
    applications,
    isLoading: isFetchingSchemas || applicationsQuery.isFetching,
  };
}
