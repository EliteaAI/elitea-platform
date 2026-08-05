import type { ReactNode } from 'react';

import { BasicAccordion } from '@/shared/ui/BasicAccordion';

import { useEliteaTitleValidation, useInitRequiredFields, useIntegerConstraintsValidation, useRequiredFieldsValidation } from './ToolBase.effects';
import { createHandleInputChange } from './ToolBase.handlers';
import { resolveCoreProps, resolveCredentialContext, resolveFieldBehavior, resolveFieldOrder, resolveFieldPresentation, resolveSections } from './ToolBase.options';
import { resolveFieldEntryGroups, ToolBaseConfigurationBody, ToolBaseStatusSlots, ToolBaseToolsSection } from './ToolBase.render';
import type { ToolBasePropertyFormState } from './ToolBaseProperty';
import type { ToolBaseProps } from './ToolBase.types';
import { useIsMcpVisible } from '../../../api/useIsMcpVisible';

// Only `ToolBaseProps` is re-exported: it's the one type external callers
// actually import via `./ToolBase` (see `ToolConfluence.tsx`/`ToolJira.tsx`/
// their tests). `ToolBaseFieldOrder`/`ToolBaseFieldVisibility`/
// `ToolBaseSections`/`ToolBaseSlots` DO have real consumers, but every one
// of them (`ToolBase.options.ts`, `ToolBase.render.tsx`) imports straight
// from `./ToolBase.types` rather than through this barrel, so re-exporting
// them here was dead weight. `ToolBaseContext`/`ToolBaseToolDetail` have no
// consumer anywhere outside `ToolBase.types.ts`'s own `ToolBaseProps`
// field declarations (nested one level inside the already-reachable
// `ToolBaseProps`) — see that file's own `export` removal for the same
// reason.
export type { ToolBaseProps } from './ToolBase.types';

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
 * **R1 FIX: flat props, not a grouped `{toolDetail: {value, onChange},
 * formState, fieldVisibility, fieldOrder, ...}` shape.** `ToolBaseProps`
 * (`ToolBase.types.ts`) is now byte-for-byte the baseline's own flat prop
 * bag — the exact shape the live composition root
 * (`ToolkitForm/ToolkitForm.hooks.ts`'s `toolComponentProps`, not owned by
 * this cluster) actually spreads onto whichever of `ToolJira`/
 * `ToolConfluence`/`ToolBase`/`ToolCustom` it resolves
 * (`lib/helpers/toolComponent.helpers.ts`'s `getToolComponent`), and the
 * same shape `ToolCustomProps` (`../ToolCustom.tsx`) already accepted. The
 * previous grouped shape left `toolDetail` (and friends) `undefined`
 * whenever reached that way — `toolDetail.value` on this function's first
 * line threw a `TypeError` immediately. `ToolBase.options.ts`'s
 * `resolveCoreProps`/`resolveCredentialContext` plus the pre-existing
 * `resolveFieldPresentation`/`resolveFieldBehavior`/`resolveFieldOrder`/
 * `resolveSections` now resolve the flat `props` object straight into the
 * SAME internal grouped shapes `ToolBase.render.tsx`/`ToolBaseProperty.tsx`
 * consume — those files, and their own grouped internal contracts, are
 * unchanged; only this function's own public boundary moved.
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
 *  - **`ToolkitForm.NameDescriptionInput`/OpenAPI editor — wired directly,
 *    not slot-only.** R2 fix: `slots.renderNameDescriptionInput`/
 *    `slots.renderOpenApiSpecField` remain available as caller OVERRIDES
 *    (still used by this file's/`ToolBaseProperty.dispatch.tsx`'s own
 *    tests), but the real, now-landed intra-slice siblings
 *    (`../NameDescriptionInput.tsx`, `../ToolOpenAPI/{OpenAPISchemaInput,
 *    OpenAPIActions}.tsx`) are the DEFAULT when no slot is supplied — see
 *    `ToolBase.render.tsx`'s `resolveNameDescriptionSlot`/
 *    `ToolBaseProperty.dispatch.tsx`'s `renderOpenapiSpec`. Previously both
 *    were slot-only with no real caller ever supplying one (the live
 *    composition root, `ToolkitForm.hooks.ts`, has no `slots` concept at
 *    all — R1), so both silently rendered blank in production; restoring
 *    them as the default matches the baseline, which rendered both inline,
 *    unconditionally, no caller injection needed (`ToolBase.jsx:225-245`,
 *    `ToolBaseProperty.jsx:230-276`). `slots.renderCredentialLikeField`
 *    (the 7 `CredentialsSelect`/`@/components/*` "smart select" branches)
 *    stays slot-only and still defaults to blank — `CredentialsSelect` is a
 *    genuinely different `features/` slice (`no-sideways-features`, a real
 *    dependency-cruiser-enforced gate, not just a convention), and the other
 *    6 have no port anywhere in this app yet. Wiring a real
 *    `slots.renderCredentialLikeField` through requires the live
 *    composition root (`ToolkitForm.hooks.ts`/`ToolkitForm.tsx`, out of this
 *    cluster's file scope) to actually construct and pass one — disclosed,
 *    not fixed here.
 *  - **No ambient form context.** No Formik — `editField`/
 *    `setEditToolDetail` are plain callback props (see `types.ts`'s own doc
 *    comment).
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
export function ToolBase(props: ToolBaseProps): ReactNode {
  const core = resolveCoreProps(props);
  const { editToolDetail, setEditToolDetail, editField, toolErrors, setToolErrors, showValidation, schema, disabled, shouldUseAccordionView } = core;
  const { settings, enableEditEliteaTitle = false } = editToolDetail;

  const presentation = resolveFieldPresentation(props);
  const behavior = resolveFieldBehavior(props);
  const resolvedFieldOrder = resolveFieldOrder(props);
  const sectionsResolved = resolveSections(props.sections);
  const credentialContext = resolveCredentialContext(props);
  const isMcpExposureEnabled = useIsMcpVisible();

  useRequiredFieldsValidation(schema, settings, sectionsResolved.sectionProps, enableEditEliteaTitle, setToolErrors);
  useIntegerConstraintsValidation(schema, settings, setToolErrors);
  useInitRequiredFields(schema, settings, sectionsResolved.sectionProps, behavior.shouldInitRequiredFields, editField);
  useEliteaTitleValidation(settings, enableEditEliteaTitle, setToolErrors);

  const handleInputChange = createHandleInputChange({ schema, setToolErrors, editField, settings, onConfigurationNameChange: props.setConfigurationName });
  const entries = resolveFieldEntryGroups(schema, sectionsResolved.sectionProps, resolvedFieldOrder);
  const formState: ToolBasePropertyFormState = { toolErrors, setToolErrors, showValidation, validationErrorMessages: props.validationErrorMessages };
  const passParams = {
    formState,
    settings,
    editField,
    handleInputChange,
    disabled,
    credentialContext,
    slots: props.slots,
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
      setEditToolDetail={setEditToolDetail}
      slots={props.slots}
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
        slots={props.slots}
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
          slots={props.slots}
          disabled={disabled}
        />
      )}
    </>
  );
}
