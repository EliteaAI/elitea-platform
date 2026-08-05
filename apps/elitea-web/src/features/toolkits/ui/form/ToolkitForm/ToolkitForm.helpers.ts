import { ConfigurationMode } from '@/entities/toolkit';

import type { ConfigurationWire } from '../../../api/configurations';

import type { ToolkitConfigurationState, ToolkitFormEditDetail } from './ToolkitForm.types';

/**
 * Pure computations extracted out of `ToolkitForm.tsx`'s own function body
 * — split out purely to stay under the §3.5 complexity budget (12; the
 * un-split component measured 42). Each function here is independently
 * testable and carries no React dependency.
 */

/** Baseline `updateObjectByPath` (`common/utils.jsx`) — sets a dot-path field on `detail`, either merging into (default) or replacing an existing object value. */
export function updateDetailByPath(detail: ToolkitFormEditDetail, path: string, value: unknown, replace = false): ToolkitFormEditDetail {
  const segments = path.split('.');
  if (segments.length === 1) {
    const existing = detail[path];
    const nextValue = !replace && typeof existing === 'object' && existing !== null && typeof value === 'object' && value !== null ? { ...existing, ...value } : value;
    return { ...detail, [path]: nextValue };
  }
  const [head, ...rest] = segments;
  // `segments.length > 1` here (the `=== 1` branch above already returned),
  // so `head` always exists at runtime — this codebase's tsconfig still
  // types array-destructured elements as possibly `undefined`, so a
  // defensive guard (never actually taken) satisfies the type checker
  // without an unnecessary-assertion the linter would flag instead.
  if (head === undefined) return detail;
  const existingChild = (detail[head] as Record<string, unknown> | undefined) ?? {};
  return { ...detail, [head]: updateDetailByPath(existingChild, rest.join('.'), value, replace) };
}

/**
 * [R1] `editField`'s auto-select dirty-suppression — baseline: `ToolkitForm.jsx:
 * 286-291`, fired when a child selector auto-picks a fallback value on the
 * user's behalf (`options: { isAutoSelect: true }`, e.g. a shared
 * credential/embedding-model default). The baseline's `resetForm({ values:
 * updatedValues })` sets BOTH Formik's `values` AND `initialValues` to the
 * same object, which is what keeps Formik's own `dirty` flag `false` after
 * an auto-correction. This app has no ambient Formik context (see
 * `ToolkitForm.tsx`'s own module doc comment, redesign 1) — `onResetForm`
 * is the explicit-prop equivalent a caller wires up to the same effect. A
 * no-op (not called at all) when `options.isAutoSelect` is unset, matching
 * every normal, user-driven field edit. Extracted out of `editField`'s own
 * body (rather than inlined) purely to stay under the §3.5 complexity
 * budget (12).
 */
export function applyAutoSelectFormReset(
  options: { readonly isAutoSelect?: boolean } | undefined,
  formValues: Readonly<Record<string, unknown>>,
  field: string,
  value: unknown,
  onResetForm: ((values: Readonly<Record<string, unknown>>) => void) | undefined,
): void {
  if (!options?.isAutoSelect) return;
  onResetForm?.(updateDetailByPath(formValues, field, value));
}

/** `ToolkitForm.jsx:569`'s `excludedFields`: only the `mcp` type excludes its own discovery-config fields. */
export function resolveExcludedFields(toolType: string): readonly string[] {
  return toolType === 'mcp' ? ['discovery_mode', 'discovery_interval'] : [];
}

/**
 * Baseline: `integrations.some(integration => integration ===
 * 'integration_' + toolkitTypeSuffix)`, comparing each list entry directly
 * against a string — implying the baseline's `section: 'credentials'`
 * response `items` are themselves plain type-name strings (e.g.
 * `'integration_github'`), NOT the `ConfigurationWire` OBJECT shape this
 * same endpoint returns for every other section (verified against
 * `features/credentials/api/configurations.ts`'s `ConfigurationWire[]`,
 * itself checked against the identical baseline `api/configurations.js`).
 * Read defensively either way — a bare string compares directly, an object
 * falls back to its own `.type` field — so this degrades to `false` (never
 * fabricating a match) rather than crashing, whichever shape the real
 * backend actually returns for this section.
 */
export function resolveSupportsConfiguration(integrations: readonly (string | ConfigurationWire)[], toolType: string): boolean {
  return integrations.some((integration) => {
    const typeName = typeof integration === 'string' ? integration : integration.type;
    return typeName === `integration_${toolType}`;
  });
}

/** `ToolkitForm.jsx:213-231}`'s `shouldShowDisabledConfigFields`: a saved toolkit whose configuration reference has no title yet, for a type that DOES support one, needs its config fields disabled rather than blank. Never true while creating (`!isEditing`) or while an in-progress "create configuration" flow (`CreatePersonal`/`CreateProject`) is selected. */
export function resolveDisabledConfigFields(configuration: ToolkitConfigurationState, isEditing: boolean, supportsConfiguration: boolean): boolean {
  const configurationTitle = configuration.elitea_title ?? '';
  const isCreateMode = configurationTitle === ConfigurationMode.CreatePersonal || configurationTitle === ConfigurationMode.CreateProject || !isEditing;
  if (isCreateMode) return false;
  return !configurationTitle && supportsConfiguration;
}

/**
 * DISCLOSED FIX (found by this sub-unit's own tests, not a baseline
 * behaviour): the baseline's own gate — `isFetching ||
 * editToolDetail?.isLoadingConfigurations` (`ToolkitForm.jsx:500`) —
 * triggers a mount/refetch loop against THIS sub-unit's OWN test harness
 * (`features/toolkits/__tests__/testUtils.tsx`), which — unlike the real
 * app — builds its `QueryClient` with TanStack Query's library default
 * `staleTime: 0`. `isFetching` is true for every TanStack Query fetch,
 * including a background refetch of already-cached data, not only the
 * first load. `ToolkitForm.tsx`'s own `ToolComponent` mounts `ToolCustom`
 * (`../ToolCustom.tsx`, this sub-unit's own file), which independently
 * calls the same `useGetCurrentToolkitSchemas()` query — at `staleTime: 0`,
 * every FRESH mount of that nested subscription triggers another
 * background refetch of the identical query key, which flips this
 * component's OWN `isFetching` back to `true` (react-query shares fetch
 * state across every observer of one query key) -> `isLoading` -> the
 * spinner replaces `ToolComponent` -> `ToolCustom` unmounts -> the (already
 * in-flight) refetch resolves -> `isFetching` flips back to `false` ->
 * `ToolComponent` remounts `ToolCustom` -> a fresh mount triggers another
 * background refetch -> repeat. Proven via a real RED/GREEN run of this
 * file's own test suite (`ToolkitForm.test.tsx`): every test hung/failed
 * against `isFetching` alone (thousands of network calls within one test's
 * timeout window — confirmed by instrumenting the MSW handler's own call
 * count), and passes cleanly with the fix below.
 *
 * In real production this loop does NOT reproduce the same way: the app's
 * actual `QueryClient` (`app/providers/queryClient.ts:41`,
 * `createAppQueryClient`) sets `staleTime: 30_000`, so a fresh mount of the
 * nested subscription within that 30s window is served the cached value
 * with no refetch and no `isFetching` flip at all — there is no cascading
 * remount loop in production. The only production-visible effect of the
 * baseline's gate is a brief loading-spinner flash if TanStack Query's
 * automatic `refetchOnWindowFocus` fires a background refetch after 30+
 * seconds of inactivity, since `isFetching` also flips true for THAT
 * refetch. This fix eliminates even that flash: gating on "no schema
 * payload has ever arrived yet" instead breaks the cycle at its root
 * without touching `useGetCurrentToolkitSchemas.hooks.ts` (a sibling A4b
 * sub-unit's owned file, out of this sub-unit's fence) or loosening
 * TanStack Query's shared `staleTime` default for every OTHER consumer of
 * that hook: the spinner still shows for the genuine first load
 * (`toolkitSchemas === undefined`), but once any payload has landed — even
 * `{}` for a project with no toolkit types yet — a later background
 * refetch no longer toggles this gate, so `ToolComponent` stays mounted
 * and the nested subscription's own refetches stop cascading back into a
 * remount.
 */
export function resolveIsLoading(isFetching: boolean, toolkitSchemasLoaded: boolean, isLoadingConfigurations: boolean | undefined): boolean {
  return (isFetching && !toolkitSchemasLoaded) || Boolean(isLoadingConfigurations);
}

export interface OutOfBandFieldSync {
  readonly field: string;
  readonly value: unknown;
}

/** The `editToolDetail.settings` half of `resolveOutOfBandFieldSync`, split out purely to stay under the §3.5 complexity budget (12). */
function resolveSettingsFieldSync(editToolDetailSettings: Readonly<Record<string, unknown>> | undefined, formSettings: Readonly<Record<string, unknown>> | undefined): readonly OutOfBandFieldSync[] {
  const updates: OutOfBandFieldSync[] = [];
  for (const key of Object.keys(editToolDetailSettings ?? {})) {
    const newVal = editToolDetailSettings?.[key];
    if (JSON.stringify(formSettings?.[key]) !== JSON.stringify(newVal)) {
      updates.push({ field: `settings.${key}`, value: newVal });
    }
  }
  return updates;
}

/** The `editToolDetail.meta.mcp_options` half of `resolveOutOfBandFieldSync`. */
function resolveMcpOptionsFieldSync(editToolDetailMcpOptions: Readonly<Record<string, unknown>> | undefined, formMcpOptions: Readonly<Record<string, unknown>> | undefined): readonly OutOfBandFieldSync[] {
  const updates: OutOfBandFieldSync[] = [];
  for (const key of Object.keys(editToolDetailMcpOptions ?? {})) {
    const newVal = editToolDetailMcpOptions?.[key];
    if (JSON.stringify(formMcpOptions?.[key]) !== JSON.stringify(newVal)) {
      updates.push({ field: `meta.mcp_options.${key}`, value: newVal });
    }
  }
  return updates;
}

/** The baseline's second `useEffect` body (`ToolkitForm.jsx:307-341`): every `editToolDetail.settings`/`editToolDetail.meta.mcp_options` field whose value differs from the outer form's own current value needs pushing into the form via `onSetFormField`. Returns the sync list rather than performing the sync itself, so the effect (which owns `onSetFormField`) stays a thin caller. */
export function resolveOutOfBandFieldSync(editToolDetail: ToolkitFormEditDetail, formValues: Readonly<Record<string, unknown>>): readonly OutOfBandFieldSync[] {
  const formSettings = formValues.settings as Record<string, unknown> | undefined;
  const formMcpOptions = (formValues.meta as { readonly mcp_options?: Record<string, unknown> } | undefined)?.mcp_options;
  return [...resolveSettingsFieldSync(editToolDetail.settings, formSettings), ...resolveMcpOptionsFieldSync(editToolDetail.meta?.mcp_options, formMcpOptions)];
}

interface CredentialLike {
  readonly private?: boolean;
  readonly elitea_title?: string;
}

function isCredentialLike(value: unknown): value is CredentialLike {
  return typeof value === 'object' && value !== null && 'elitea_title' in value;
}

/**
 * The baseline's `onRevertCredentials` (`ToolkitForm.jsx:394-417`): every
 * settings field that CURRENTLY looks like a shared-credential reference
 * (`{elitea_title, private}`) — `orig` is read defensively via `?.` and is
 * NOT itself required to look credential-like, matching the baseline's own
 * asymmetric check (only `curr` is type-guarded) — AND changed from its
 * initial value needs reverting. Returns the field updates rather than
 * applying them, so the caller (which owns `editField`) stays a thin
 * dispatcher.
 */
export function resolveCredentialReverts(currentSettings: Readonly<Record<string, unknown>>, initialSettings: Readonly<Record<string, unknown>>): readonly OutOfBandFieldSync[] {
  const reverts: OutOfBandFieldSync[] = [];
  for (const key of Object.keys(currentSettings)) {
    const curr = currentSettings[key];
    if (!isCredentialLike(curr)) continue;
    const orig = initialSettings[key] as CredentialLike | undefined;
    if (curr.private !== orig?.private || curr.elitea_title !== orig?.elitea_title) {
      reverts.push({ field: `settings.${key}`, value: initialSettings[key] });
    }
  }
  return reverts;
}
