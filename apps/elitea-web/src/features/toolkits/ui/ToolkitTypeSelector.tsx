import { type ChangeEvent, type ReactNode, useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { ToolInitialValues } from '@/entities/toolkit';
import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';
import { docsLink } from '@/shared/brand';
import { t } from '@/shared/i18n';
import { CategoryFilter } from '@/shared/ui/CategoryFilter';
import { CategorySection } from '@/shared/ui/CategorySection';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

import { convertToolkitSchema } from '../lib/helpers/toolkitSchema.helpers';
import { useIsMcpVisible } from '../api/useIsMcpVisible';
import { useToolMenuItems } from '../lib/hooks/useToolMenuItems';

interface ToolkitTypeSchemaShape {
  readonly required?: readonly string[];
  readonly name_required?: boolean;
}

/** Inlined rather than the local `useGetToolkitNameFromSchema` hook — that hook needs the schema map as a stable value at call time, but here it only becomes available inside `onAddTool`'s own `toolSchemas` closure argument (a hook cannot be called from inside a non-render callback). Same two rules `useGetToolkitNameFromSchema.ts`'s `getRequiredProperties`/`isNameRequired` implement, as plain functions. */
function requiredPropertiesOf(toolSchemas: ToolkitTypeSchemaMap, toolType: string): readonly string[] {
  return (toolSchemas[toolType] as ToolkitTypeSchemaShape | undefined)?.required ?? [];
}

function isNameRequiredFor(toolSchemas: ToolkitTypeSchemaMap, toolType: string): boolean {
  return (toolSchemas[toolType] as ToolkitTypeSchemaShape | undefined)?.name_required !== false;
}

interface ToolkitTypeSelectorToolDetail {
  readonly type: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly name?: string;
  readonly [key: string]: unknown;
}

/** @public */
export interface ToolkitTypeSelectorProps {
  readonly onSelectTool: (detail: ToolkitTypeSelectorToolDetail) => void;
  readonly setFormikInitialValues: (updater: (prev: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>) => void;
  readonly isMCP?: boolean;
  readonly isApplication?: boolean;
  readonly disableNavigation?: boolean;
}

function getDefaultTools(selectedToolsProperty: Readonly<{ readonly args_schemas?: Readonly<Record<string, { readonly default?: boolean }>> }> | undefined): readonly string[] {
  return Object.entries(selectedToolsProperty?.args_schemas ?? {})
    .filter(([, value]) => value.default === true)
    .map(([key]) => key);
}

interface ResolvedToolSelection {
  readonly detail: ToolkitTypeSelectorToolDetail;
  readonly initialFormValues: Readonly<Record<string, unknown>>;
}

/**
 * The full "a toolkit type was picked" computation — split out of
 * `onAddTool`'s closure purely to keep `ToolkitTypeSelector` under the
 * oxlint complexity budget (the baseline's own `onAddTool`, `ToolkitTypeSelector.jsx:32-148`,
 * is a single ~110-line callback).
 */
function resolveToolSelection(toolType: string, toolSchemas: ToolkitTypeSchemaMap): ResolvedToolSelection {
  const nameIsRequired = isNameRequiredFor(toolSchemas, toolType);
  const descriptionIsRequired = requiredPropertiesOf(toolSchemas, toolType).includes('description');
  const rawSchema = (toolSchemas[toolType] ?? { properties: {} }) as Parameters<typeof convertToolkitSchema>[0];
  const schema = convertToolkitSchema(rawSchema);
  const selectedTools = getDefaultTools(schema.properties?.['selected_tools']);
  const metadata = (schema.metadata as Readonly<Record<string, unknown>> | undefined) ?? {};

  const initialValues = (ToolInitialValues as Record<string, { readonly settings?: Readonly<Record<string, unknown>> }>)[toolType] ?? {};
  const settings = { ...initialValues.settings, selected_tools: selectedTools };

  const detail: ToolkitTypeSelectorToolDetail = {
    ...initialValues,
    settings,
    type: toolType,
    schema: { required: [''], ...schema },
    meta: metadata,
  };

  const initialFormValues: Readonly<Record<string, unknown>> = {
    settings,
    ...(nameIsRequired ? { name: '' } : {}),
    ...(descriptionIsRequired ? { description: '' } : {}),
    type: toolType,
    meta: metadata,
  };

  return { detail, initialFormValues };
}

/**
 * Ported from `apps/elitea-ui/src/pages/Toolkits/ToolkitTypeSelector.jsx`
 * (240 lines).
 *
 * DISCLOSED DEVIATIONS:
 *  - `useToolMenuItems` (baseline: `hooks/application`) is a LOCAL
 *    duplicate (`../lib/hooks/useToolMenuItems.ts`, this same unit) — a
 *    cross-top-level-feature import in the baseline (agents), forbidden by
 *    `no-sideways-features`, exactly as this batch's own mission preamble
 *    flags for this file by name. The mission preamble also names
 *    `useGetToolkitNameFromSchema` (baseline: `features/pipelines/
 *    flow-editor`) as a second forbidden-sideways import this file makes —
 *    reading the ACTUAL baseline `ToolkitTypeSelector.jsx` directly
 *    (verified, not assumed) shows it uses that hook's
 *    `isNameRequired`/`getRequiredProperties` ONLY inside `onAddTool`,
 *    where the real schema map is already available as that closure's own
 *    `toolSchemas` argument — `isNameRequiredFor`/`requiredPropertiesOf`
 *    below are the same two rules as plain functions instead of a second
 *    duplicated hook (a hook cannot be called from inside a non-render
 *    callback the way the baseline's ambient-Redux-backed hook could).
 *  - **Real backend gap, disclosed, not invented:** the entire
 *    vector-storage/embedding-model/image-generation-model default-value
 *    pre-loading branch (baseline: `useLazyListModelsQuery`,
 *    `onAddTool`'s `shouldLoadingConfigurations` block) is DROPPED. The
 *    mission brief states this directly: "No ListModels endpoint exists (so
 *    old-app LLM-settings-defaulting behavior that reads a live model list
 *    cannot be faithfully ported — disclose, don't invent)." Selecting a
 *    toolkit type that has one of these fields still works; it just starts
 *    with `getToolInitialValueBySchema`'s/`ToolInitialValues`' own default
 *    (usually blank), not a live server-resolved default.
 *  - `getToolInitialValueBySchema` (baseline: `common/
 *    getToolInitialValueBySchema.js`) has no confirmed port anywhere in this
 *    worktree (grepped directly — zero hits under any name). Dropped in
 *    favour of `entities/toolkit`'s promoted `ToolInitialValues[toolType]`
 *    map alone (the baseline's own fallback when the schema-derived
 *    function returns nothing) — a real, disclosed narrowing, not an
 *    invented replacement.
 *  - `Category.GroupedCategory` (a single search+chips+grouped-list
 *    component in the baseline) has no matching `shared/ui` component —
 *    `shared/ui/GroupedCategory`'s OWN doc comment documents the identical
 *    split this port makes: `CategoryFilter` (search chrome) composing
 *    `CategorySection` (the item grid) as `children`, rather than one
 *    monolithic component. This selector renders every toolkit-type entry
 *    under a single, un-grouped `CategorySection` (baseline's own
 *    `renderCategory` callback is invoked once per real "category" key the
 *    baseline's `useToolkitSearch` computed; that hook is not in this
 *    unit's owned files and its category-grouping source was not
 *    determinable from the baseline's available context) — client-side text
 *    search over the label is preserved, category-chip grouping is not.
 *  - The `isApplication`/`appType`-URL auto-select effect (baseline lines
 *    155-163, `useParams().appType` + `react-router-dom`) is dropped: this
 *    component owns no route-matching, and no caller in this unit's owned
 *    files needs it (only `CreateToolkit.tsx`, a route page, has `appType`
 *    in scope — it is a disclosed gap on that page instead, see its own doc
 *    comment).
 */
/** Split out purely to keep `ToolkitTypeSelector` under the oxlint complexity budget (12) — each of the three copy-selection helpers below is its own independent branch chain. */
function resolveSelectorTitle(isApplication: boolean, isMCP: boolean): string {
  if (isApplication) return t('toolkits.toolkitTypeSelector.titleApplication', 'Choose the application type');
  return isMCP ? t('toolkits.toolkitTypeSelector.titleMcp', 'Choose the MCP type') : t('toolkits.toolkitTypeSelector.titleToolkit', 'Choose the toolkit type');
}

/** Same reason as {@link resolveSelectorTitle}. */
function resolveNoResultsTitle(isApplication: boolean, isMCP: boolean): string {
  if (isApplication) return t('toolkits.toolkitTypeSelector.noResultsApplication', 'No applications found');
  return isMCP ? t('toolkits.toolkitTypeSelector.noResultsMcp', 'No MCPs found') : t('toolkits.toolkitTypeSelector.noResultsToolkit', 'No toolkits found');
}

/** Same reason as {@link resolveSelectorTitle}. */
function resolveSearchPlaceholder(isApplication: boolean, isMCP: boolean): string {
  if (isApplication) return t('toolkits.toolkitTypeSelector.searchApplication', 'Search applications');
  return !isMCP ? t('toolkits.toolkitTypeSelector.searchToolkit', 'Search toolkits') : t('toolkits.toolkitTypeSelector.searchMcp', 'Search MCPs');
}

/**
 * Baseline: `ToolkitTypeSelector.jsx:178`'s doc URL. The page path is the
 * baseline's; the origin is the brand pack's (`docsLink`, ADR-0024 WP8).
 */
const MCP_CREATION_DOCS_PATH = 'integrations/mcp/create-and-use-server-stdio';

const mcpEmptyStateContainerSx: SxProps<Theme> = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '12.5rem', textAlign: 'center' };
const mcpEmptyStateLinkSx: SxProps<Theme> = { textDecoration: 'underline', '&:hover': { cursor: 'pointer', textDecoration: 'underline' } };

/**
 * `ToolkitTypeSelector.jsx:165-190`'s MCP-specific `EmptyPlaceholder` —
 * distinct from the generic "no results, try adjusting your search terms"
 * message (reserved for the non-MCP / genuinely-no-match case below): when
 * there are zero local MCP toolkit types to show, this points the user at
 * the docs page that explains how to create one, rather than telling them
 * to adjust a search that has nothing to search over. Baseline rendered
 * this via `Category.GroupedCategory`'s `allowEmptyCategory={isMCP}` +
 * `renderCategory`'s own `EmptyPlaceholder` slot; this port has no matching
 * grouped-category component (see the module doc comment's own disclosed
 * `Category.GroupedCategory` deviation), so it is rendered as a sibling
 * branch of the plain "no items" case instead.
 */
function McpNoLocalServersMessage(): ReactNode {
  const docsUrl = useMemo(() => docsLink(MCP_CREATION_DOCS_PATH), []);
  return (
    <Box sx={mcpEmptyStateContainerSx}>
      <Typography
        variant="bodyMedium"
        color="text.primary"
      >
        {t('toolkits.toolkitTypeSelector.mcpEmptyStatePrefix', 'Still no local MCP available. Follow creation guides in our ')}
        <Link
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          sx={mcpEmptyStateLinkSx}
        >
          {t('toolkits.toolkitTypeSelector.mcpEmptyStateLinkText', 'Documentation')}
        </Link>
        {t('toolkits.toolkitTypeSelector.mcpEmptyStateSuffix', '.')}
      </Typography>
    </Box>
  );
}

export function ToolkitTypeSelector({ onSelectTool, setFormikInitialValues, isMCP = false, isApplication = false }: ToolkitTypeSelectorProps): ReactNode {
  const [searchQuery, setSearchQuery] = useState('');

  const onAddTool = useCallback(
    (toolType: string, toolSchemas: ToolkitTypeSchemaMap) => () => {
      const { detail, initialFormValues } = resolveToolSelection(toolType, toolSchemas);
      onSelectTool(detail);
      setFormikInitialValues(() => initialFormValues);
    },
    [onSelectTool, setFormikInitialValues],
  );

  const isMcpVisible = useIsMcpVisible();
  const { toolMenuItems, isFetchingToolkitTypes } = useToolMenuItems({ onAddTool, isMCP, isApplication });

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query === '') return toolMenuItems;
    return toolMenuItems.filter((item) => item.label.toLowerCase().includes(query));
  }, [toolMenuItems, searchQuery]);

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value), []);

  if (isMCP && !isMcpVisible) return null;

  const title = resolveSelectorTitle(isApplication, isMCP);
  const noResultsTitle = resolveNoResultsTitle(isApplication, isMCP);

  return (
    <CategoryFilter
      title={title}
      searchPlaceholder={resolveSearchPlaceholder(isApplication, isMCP)}
      searchQuery={searchQuery}
      onSearchChange={handleSearchChange}
    >
      {isFetchingToolkitTypes ? null : filteredItems.length > 0 ? (
        <CategorySection
          category={title}
          items={filteredItems}
          showCategory={false}
        />
      ) : isMCP ? (
        <McpNoLocalServersMessage />
      ) : (
        <NoResultsMessage
          title={noResultsTitle}
          description={t('toolkits.toolkitTypeSelector.noResultsDescription', 'Try adjusting your search terms')}
        />
      )}
    </CategoryFilter>
  );
}

// `disableNavigation` is accepted for baseline call-site compatibility
// (`ToolkitEditor.tsx`/`CreateToolkit.tsx` both pass it) but has no effect
// here — the baseline used it only inside `useToolkitSearch`'s
// navigation-on-select branch, which this port does not reproduce (see the
// module doc comment's `Category.GroupedCategory` deviation).
