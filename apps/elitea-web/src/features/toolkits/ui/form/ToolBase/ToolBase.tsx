import type { ReactNode } from 'react';

import { BasicAccordion } from '@/shared/ui/BasicAccordion';

import { useEliteaTitleValidation, useInitRequiredFields, useIntegerConstraintsValidation, useRequiredFieldsValidation } from './ToolBase.effects';
import { createHandleInputChange } from './ToolBase.handlers';
import { resolveFieldBehavior, resolveFieldOrder, resolveFieldPresentation, resolveSections } from './ToolBase.options';
import { resolveFieldEntryGroups, ToolBaseConfigurationBody, ToolBaseStatusSlots, ToolBaseToolsSection } from './ToolBase.render';
import type { ToolBaseProps } from './ToolBase.types';
import { useIsMcpVisible } from '../../../api/useIsMcpVisible';

export type {
  ToolBaseContext,
  ToolBaseFieldOrder,
  ToolBaseFieldVisibility,
  ToolBaseProps,
  ToolBaseSections,
  ToolBaseSlots,
  ToolBaseToolDetail,
} from './ToolBase.types';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/
 * ToolBase/ToolBase.jsx` (612 lines) — the top-level dynamic settings-form
 * renderer for a toolkit/tool's JSON-Schema `properties`: name/description,
 * priority/main/advanced/bottom-of-form field passes, metadata `sections`,
 * and the `selected_tools` chip picker.
 *
 * Split across 5 files to stay under the §3.5 400-line/12-complexity
 * budgets (the baseline is one 612-line, complexity-69 function):
 * `ToolBase.types.ts` (prop-group interfaces), `ToolBase.options.ts`
 * (destructuring-default resolution), `ToolBase.handlers.ts`
 * (`handleInputChange`), `ToolBase.render.tsx` (the JSX-producing pieces +
 * field-entry-list resolution), `ToolBase.effects.ts` (the 4 mount/update
 * effects). This file is now just composition: resolve the caller's option
 * groups, run the 4 effects, build the property-pass params bag once, and
 * render the 3 top-level pieces (status slots, configuration body, tools
 * section). A file-organization change only, no behaviour change.
 *
 * **DISCLOSED REDESIGN, several independent reasons — read before wiring
 * this up:**
 *  - **`no-sideways-features`, no carve-out.** The baseline directly
 *    renders `McpAuthStatus`/`SharepointOAuthStatus` (`features/mcp`,
 *    `features/sharepoint` — this app: both would live in `features/mcps`)
 *    and `OpenApiOAuthStatus` (baseline `features/openapi`) — three
 *    genuinely different `features/` slices from `features/toolkits`.
 *    `slots.mcpAuthStatus`/`slots.sharepointOAuthStatus`/
 *    `slots.openApiOAuthStatus` are `ReactNode` slots instead; this
 *    component keeps exactly its own logic (the `isAnyMcpType`/
 *    `isSharepointToolkit`/`isOpenApiToolkit` boolean gates, computed from
 *    `schema.title`/`editToolDetail.type`), the caller supplies the actual
 *    widget.
 *  - **`ToolkitForm.NameDescriptionInput` (A4d) — slot, not a direct
 *    import.** `slots.renderNameDescriptionInput` is a render-prop slot
 *    (`NameDescriptionInputSlotProps`, `ToolBase.slots.ts`) carrying the
 *    exact same argument shape the baseline passed as JSX props, rather
 *    than a direct import of `ui/form/NameDescriptionInput.tsx`. That file
 *    DID land intra-slice partway through this unit's build (confirmed by
 *    re-checking after most of this file was already written) — R-L3 would
 *    allow importing it directly now — but its real, independently-designed
 *    prop contract is not a drop-in match for this file's own types
 *    (`editField: (field: 'name'|'description', value: string) => void` vs.
 *    this file's general-path `EditToolField`; `toolErrors: Record<string,
 *    boolean|undefined>` vs. this file's `boolean|string`-valued
 *    `ToolErrors`; `configuration_title` vs. this slot's `configurationTitle`)
 *    — wiring it for real is a follow-up integration task, not a rename.
 *    The slot already carries every value that component needs; a caller
 *    can do `(props) => <NameDescriptionInput {...props}
 *    configuration_title={props.configurationTitle} .../>` today with a
 *    thin adapter, or this slot can be dropped once the two contracts are
 *    reconciled. Same not-yet-landed-at-write-time reasoning, still
 *    accurate at time of writing, applies to the two `ToolBaseProperty.tsx`
 *    slots this component forwards unchanged: `slots.renderOpenApiSpecField`/
 *    `slots.renderCredentialLikeField`.
 *  - **No ambient form context.** No Formik — `editField`/`toolDetail.
 *    onChange` are plain callback props (see `types.ts`'s own doc comment).
 *  - **`useToolkitConfigurationProperties` (`sections`) is a legacy
 *    top-level `hooks/*.js` file, not owned by any Wave-2 sub-unit's
 *    mission brief, and is itself RTK-Query-backed (`useGetCurrentToolkitSchemas`/
 *    `useGetCurrentConfigurationAsSchemas`).** Spec §3.6 ("a component
 *    either renders or fetches, never both") means `ToolBase` should not
 *    own that fetch regardless of slice boundaries — `sections`/
 *    `sectionProps` are a caller-supplied prop group instead
 *    (`ToolBaseSections`).
 *  - **`useToolkitView` (`shouldUseAccordionView`) is route-matching**
 *    (`react-router-dom`'s `useSearchParams` + a `RouteDefinitions` table
 *    this app's TanStack-Router-based app does not have) — a caller-
 *    supplied boolean for the same "don't own route-derived presentation
 *    state" reason.
 *  - **`useSystemSenderName` is env-setting-fetch-backed**
 *    (`useGetConfigurationsListQuery`, RTK Query) with no generated-client
 *    equivalent traced in this pass. The `elitea_title` validation message
 *    it feeds falls back to the same literal default the baseline's own
 *    hook falls back to (`DEFAULT_PARTICIPANT_NAME`, `'Elitea'`,
 *    `shared/lib/copy.ts`) — a real, disclosed accuracy gap only for a
 *    tenant that has customised this one environment setting.
 *  - **`useGetRemoteMcpTools`/`McpAuthModal`'s "Load Tools" flow is
 *    `features/mcps`-owned** (`no-sideways-features`) — `slots.
 *    toolActionsExtra` (`onLoadTools`/`isLoadingTools`/`canLoadTools`/
 *    `mcpAuthModal`) is forwarded straight to `ToolActionsSelector.tsx`
 *    (see that file's own doc comment). The baseline's `handleToolsFetched`
 *    (auto-selecting newly-fetched MCP tools into `editToolDetail.settings`)
 *    is dropped from THIS file: the caller already owns `toolDetail.
 *    onChange` (`setEditToolDetail`) for other reasons, so it can implement
 *    the identical `onToolsFetched` callback itself when wiring its own
 *    `useGetRemoteMcpTools()` call — nothing here can do that wiring on the
 *    caller's behalf since the caller, not `ToolBase`, owns the hook call.
 */
export function ToolBase({
  toolDetail,
  editField,
  formState,
  schema,
  onConfigurationNameChange,
  fieldVisibility,
  fieldOrder,
  disabled,
  credentialContext,
  slots,
  context,
  sections: sectionsProp,
}: ToolBaseProps): ReactNode {
  const editToolDetail = toolDetail.value;
  const { settings, enableEditEliteaTitle = false } = editToolDetail;

  const presentation = resolveFieldPresentation(fieldVisibility);
  const behavior = resolveFieldBehavior(fieldVisibility);
  const resolvedFieldOrder = resolveFieldOrder(fieldOrder);
  const sectionsResolved = resolveSections(sectionsProp);
  const shouldUseAccordionView = context?.shouldUseAccordionView ?? true;
  const isMcpExposureEnabled = useIsMcpVisible();

  useRequiredFieldsValidation(schema, settings, sectionsResolved.sectionProps, enableEditEliteaTitle, formState.setToolErrors);
  useIntegerConstraintsValidation(schema, settings, formState.setToolErrors);
  useInitRequiredFields(schema, settings, sectionsResolved.sectionProps, behavior.shouldInitRequiredFields, editField);
  useEliteaTitleValidation(settings, enableEditEliteaTitle, formState.setToolErrors);

  const handleInputChange = createHandleInputChange({ schema, setToolErrors: formState.setToolErrors, editField, settings, onConfigurationNameChange });
  const entries = resolveFieldEntryGroups(schema, sectionsResolved.sectionProps, resolvedFieldOrder);
  const passParams = {
    formState,
    settings,
    editField,
    handleInputChange,
    disabled,
    credentialContext,
    slots,
    editFieldRootPath: resolvedFieldOrder.editFieldRootPath,
    showOnlyRequiredFields: presentation.showOnlyRequiredFields,
    showDisabledConfigFields: behavior.disabledConfigFieldsForOldToolkits,
    enableEditEliteaTitle,
  };

  const configurationBody = (
    <ToolBaseConfigurationBody
      editToolDetail={editToolDetail}
      schema={schema}
      passParams={passParams}
      entries={entries}
      presentation={presentation}
      behavior={behavior}
      sectionsResolved={sectionsResolved}
      setEditToolDetail={toolDetail.onChange}
      slots={slots}
      checkboxAsteriskRequired={behavior.checkboxAsteriskRequired}
      showDisabledConfigFields={behavior.disabledConfigFieldsForOldToolkits}
      disabled={disabled}
    />
  );

  return (
    <>
      <ToolBaseStatusSlots
        schema={schema}
        editToolDetail={editToolDetail}
        slots={slots}
        showTools={behavior.showTools}
      />
      {shouldUseAccordionView ? <BasicAccordion items={[{ title: 'Configuration', content: configurationBody }]} /> : configurationBody}
      {behavior.showTools && (
        <ToolBaseToolsSection
          schema={schema}
          editToolDetail={editToolDetail}
          passParams={passParams}
          isMcpExposureEnabled={isMcpExposureEnabled}
          shouldUseAccordionView={shouldUseAccordionView}
          slots={slots}
          disabled={disabled}
        />
      )}
    </>
  );
}
