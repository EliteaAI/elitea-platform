import type { ReactNode } from 'react';

import type { AgentPipelineVersionOption, AgentToolAssociation } from '../lib/types';

/**
 * `ToolCard`'s prop-group types, split out of `ToolCard.tsx` purely to keep
 * that file under the §3.5 400-line budget. Original: `apps/elitea-ui/src/
 * pages/Applications/Components/Tools/ToolCard.jsx` (819 lines) — the
 * largest, most cross-cutting file in this sub-unit (A1h).
 *
 * MAJOR DISCLOSED REDESIGN, read before extending this component. The
 * baseline reads/writes an ambient Formik form and calls ~10 hooks that
 * reach into slices this sub-unit either does not own or is not permitted
 * to import:
 *  - `useDisassociateToolkit`/`useSaveAgentToolVariables` (`features/agent`
 *    old app = `features/agents`/A1 new app, but a DIFFERENT A1 sub-unit's
 *    owned files — real, Redux/Formik/RTK-Query-entangled mutation hooks,
 *    not something this unit can faithfully re-derive without also
 *    building the top-level agent-edit form state machine).
 *  - `useMcpTokenChange`/`McpLogInButton`/`McpLogoutButton` (`features/mcp`
 *    old app = `features/mcps` new app — a DIFFERENT top-level feature
 *    slice; `no-sideways-features` in `.dependency-cruiser.cjs` is
 *    absolute, no carve-out, confirmed by reading the rule directly).
 *  - `useResolvedSharepointConfig`/`SharepointDelegatedLoginButton`
 *    (`features/sharepoint`), `useResolvedOpenApiConfig`/
 *    `OpenApiDelegatedLoginButton` (`features/openapi`) — same
 *    cross-feature-slice problem.
 *  - `useGetToolkitNameFromSchema` (`features/pipelines/flow-editor`),
 *    `useGetToolkitIconMeta`/`ToolkitsHelpers` (`features/toolkits`) — same
 *    problem again; toolkit-schema lookups belong to the toolkits domain.
 *  - `useManualValidateApplicationVersion`/`useToolValidationInfo` — no
 *    faithful port is even possible: this batch's own brief discloses the
 *    generated client's validate-application-version endpoint is a plain
 *    `{valid: boolean}` check with none of the `toolkit_errors` detail this
 *    component's `toolValidationMessage`/`validationBanner` logic needs,
 *    and no toolkit-validation endpoint exists at all.
 *  - `useFormikContext()` itself — this app is react-hook-form (spec
 *    §2.3), but more importantly this cluster carries NO ambient form
 *    context at all (unlike `entities/application-form`'s slot-based
 *    `ApplicationConfigurationLayout`, nothing here assumes a specific
 *    top-level form shape `useFormContext<T>()` could safely name).
 *
 * Every one of those becomes an explicit, typed, caller-supplied prop
 * instead — same "caller-computed" shape this codebase already established
 * repeatedly for exactly this class of problem (`entities/application-form/
 * model/mutations.ts`, `features/credentials/ui/CredentialsControls.tsx`,
 * `features/mcps/model/useMcpAuthModal.ts`'s `projectId`/toast deviations).
 * §3.5 caps component props at 12; the props below are grouped into
 * PascalCase-named objects along that same seam (mirroring
 * `entities/application-form/ui/ApplicationConfigurationLayout.tsx`'s own
 * slot-prop precedent) to stay inside that budget while still exposing
 * everything the baseline exposed.
 *
 * `index`/`applicationId` are DROPPED entirely (not even folded into a
 * group): every baseline use of them was to build a `setFieldValue` path or
 * to pass to a hook this port no longer calls internally — the caller
 * already has both in scope from mapping over `version_details.tools[]`
 * with `applicationId` closed over, so re-threading them through this
 * component would be dead props.
 */
export interface ToolCardContext {
  /** Replaces `useSelectedProjectId()` — `features/` cannot reactively read the selected project id yet, see `src/app/router-context.ts`'s own doc comment ("this almost certainly blocks every OTHER Wave-2 A* unit the same way"). */
  readonly selectedProjectId?: string | number | undefined;
  readonly entityProjectId?: string | number | undefined;
  /** Replaces `viewModeFromUrl` (`useSearchParamValue`) + the permission-based fallback (`useCheckPermission`) — same `string` (not a union) contract `entities/application-form`'s `ApplicationConfigurationLayoutProps.viewMode` already established for this exact value, one layer up in the same slot tree. */
  readonly viewMode: string;
  /** Replaces `useFormikContext().values.version_details.id`. */
  readonly versionId?: number | string | undefined;
  /** Replaces `useFormikContext().values.version_details.meta.attachment_toolkit_id`. */
  readonly attachmentToolkitId?: number | string | undefined;
  /** Replaces `ToolkitsHelpers.isToolkitTypeBlocked`'s module-level `BLOCKED_TOOLKITS` read — `shared/config` has no `blocked_toolkits` key yet (real, disclosed gap, see `../lib/toolkitBlocklist.ts`). */
  readonly blockedToolkitTypes?: readonly string[] | undefined;
}

/** Not separately imported anywhere (structural field of `ToolCardProps.icon` only) — kept un-exported so knip does not flag it as a dead named export; a caller building a `ToolCardProps` value satisfies this shape structurally without needing to import it by name. */
interface ToolCardIcon {
  readonly component?: ReactNode | undefined;
  readonly url?: string | undefined;
}

export interface ToolCardDisassociateProps {
  /** Replaces `useDisassociateToolkit().onDisassociateTool`; `isAttachmentToolkit` is passed back because this component already computed it (from `tool.id`/`context.attachmentToolkitId`) and the caller would otherwise have to redo that computation. */
  readonly onDisassociateTool: (args: { readonly isAttachmentToolkit: boolean }) => void;
  readonly isDisassociating?: boolean | undefined;
}

/** Un-exported, see `ToolCardIcon` above for why. */
interface ToolCardVariablesProps {
  /** Replaces `useSaveAgentToolVariables().onChangeVariable`. `showVariables`/`onToggleVariables` stay LOCAL state (trivial UI toggle, no external coupling) and `variables` is read straight from `tool.variables` — both were pass-throughs in the baseline hook too. */
  readonly onChangeVariable: (label: string, newValue: string) => void;
}

/** Un-exported, see `ToolCardIcon` above for why. */
interface ToolCardToolSelectionProps {
  /** Replaces `useGetToolkitNameFromSchema().getSelectedTools(tool.type)` — the toolkit-type's full available-tool-name list from its schema (`features/toolkits` territory). */
  readonly availableTools?: readonly string[] | undefined;
  /** Replaces `EnhancedCardToolActions`'s internal `setFieldValue` call (now threaded through `EnhancedCardToolActionsProps.onSelectedToolsChange`, see that file). */
  readonly onSelectedToolsChange: (newSelectedTools: readonly string[]) => void;
  /** Replaces `useGetToolkitNameFromSchema().getToolkitNameFromSchema` — the LAST-resort `toolkitName` fallback, only reached when every other name field is absent. */
  readonly resolveToolkitNameFromSchema?: ((tool: AgentToolAssociation) => string) | undefined;
}

export interface ToolCardValidationProps {
  /** Replaces `!!validationInfo` — drives the attention icon + refresh-button visibility. `true` even though this app currently has no way to populate real per-tool validation detail (real, disclosed backend gap); a caller with some other issue signal (e.g. a 404'd sub-agent) can still set this. */
  readonly hasIssue: boolean;
  /** Replaces the computed `validationBanner` JSX. Backend-gap-driven AND cross-feature-driven (the credential-not-found case renders `features/credentials`' `CredentialWarningBanner`, which this slice cannot import) — the caller renders the whole banner and hands it in fully composed, same seam `ApplicationConfigurationLayout`'s slots use. */
  readonly banner?: ReactNode | undefined;
  /** Replaces `useManualValidateApplicationVersion().doValidateVersion`. */
  readonly onRevalidate?: (() => void) | undefined;
}

export interface ToolCardDelegatedAuthProps {
  /** Replaces `tool.online || hasRemoteMcpLoggedIn` (`useMcpTokenChange`). */
  readonly mcpIsAuthorized?: boolean | undefined;
  /** Replaces `<McpLogInButton values={tool} />` (`features/mcps`). */
  readonly mcpLoginSlot?: ReactNode | undefined;
  /** Replaces `<McpLogoutButton .../>` (`features/mcps`). */
  readonly mcpLogoutSlot?: ReactNode | undefined;
  /** Replaces `<SharepointDelegatedLoginButton .../>` (`features/sharepoint`). */
  readonly sharepointLoginSlot?: ReactNode | undefined;
  /** Replaces `<OpenApiDelegatedLoginButton .../>` (`features/openapi`). */
  readonly openApiLoginSlot?: ReactNode | undefined;
}

export interface ToolCardVersionSelectorProps {
  readonly versions: readonly AgentPipelineVersionOption[];
  readonly isRefreshingVersions?: boolean | undefined;
  readonly onRefreshVersions?: (() => void) | undefined;
  readonly isSwitchingVersion?: boolean | undefined;
  readonly onSelectVersion: (version: AgentPipelineVersionOption) => void;
}

export interface ToolCardProps {
  readonly tool: AgentToolAssociation;
  readonly disabled?: boolean | undefined;
  readonly isDuplicate?: boolean | undefined;
  readonly context: ToolCardContext;
  readonly icon?: ToolCardIcon | undefined;
  readonly disassociate: ToolCardDisassociateProps;
  /**
   * OPTIONAL, and omitting it WITHHOLDS the whole variables control — no
   * "Show variables" toggle, no variables panel, regardless of
   * `tool.variables` (#248). There is nowhere to store per-tool variables on
   * this backend (no column, no table, no `tools` branch in `UpdateVersion`,
   * and `fetchVersionDetails` emits no `variables` key), so the only caller
   * — `AgentToolRow`, see its module doc comment — passes nothing rather than
   * offering an editable field whose input is discarded. Hidden, not
   * disabled, matching the legacy baseline's own omit-when-empty gate.
   */
  readonly variables?: ToolCardVariablesProps | undefined;
  readonly toolSelection: ToolCardToolSelectionProps;
  readonly validation?: ToolCardValidationProps | undefined;
  readonly delegatedAuth?: ToolCardDelegatedAuthProps | undefined;
  /** Required (and read) only when `tool.type === 'application'`. */
  readonly versionSelector?: ToolCardVersionSelectorProps | undefined;
}
