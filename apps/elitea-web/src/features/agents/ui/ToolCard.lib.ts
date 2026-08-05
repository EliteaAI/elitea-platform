import type { ReactNode } from 'react';

import { t } from '@/shared/i18n';
import { SearchParams } from '@/shared/lib/params';

import { isPrebuildMcpType } from '../lib/mcpType';
import { isToolkitTypeBlocked } from '../lib/toolkitBlocklist';
import type { AgentToolAssociation, AgentToolAvailableToolOption } from '../lib/types';

import type { ToolCardActionButtonConfig } from './ToolCardActionsCluster';
import type { ToolCardContext, ToolCardDelegatedAuthProps, ToolCardDisassociateProps, ToolCardValidationProps } from './ToolCard.types';

/**
 * `ToolCard`'s pure computation helpers, split out of `ToolCard.tsx` purely
 * to keep that file under the §3.5 400-line budget AND the `oxlint`
 * `complexity` budget (≤12) — each helper here is its OWN function scope,
 * so its internal branches count toward ITS complexity, not `ToolCard`'s.
 */

function capitalizeType(type: string | undefined): string | undefined {
  if (typeof type !== 'string' || !type) return undefined;
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Ported from `ToolCard.jsx:162-177` (`toolkitName` useMemo), minus the trailing `getToolkitNameFromSchema(tool)` call which is now the caller-supplied `resolveFromSchema` (see `ToolCard.types.ts`'s `ToolCardToolSelectionProps`). */
export function resolveToolkitName(tool: AgentToolAssociation, resolveFromSchema: ((tool: AgentToolAssociation) => string) | undefined): string {
  if (tool.type === 'application') return tool.name || 'Unnamed';
  const candidates = [tool.elitea_title, tool.name, tool.toolkit_name, tool.settings?.configuration_title, capitalizeType(tool.type), resolveFromSchema?.(tool)];
  return candidates.find((candidate) => !!candidate) ?? 'Toolkit';
}

/** Ported from `ToolCard.jsx:262-285` (`toolOptions` useMemo). */
export function normalizeAvailableToolOptions(options: readonly (string | AgentToolAvailableToolOption)[]): readonly AgentToolAvailableToolOption[] {
  return options
    .map((item): AgentToolAvailableToolOption | null => {
      if (typeof item === 'string') {
        return { label: `${item.charAt(0).toUpperCase()}${item.slice(1)}`.replaceAll('_', ' '), value: item };
      }
      const name = item.value ?? item.name ?? item.label;
      if (typeof name !== 'string' || !name.trim()) return null;
      return { label: item.label ?? `${name.charAt(0).toUpperCase()}${name.slice(1)}`.replaceAll('_', ' '), value: name };
    })
    .filter((item): item is AgentToolAvailableToolOption => item !== null);
}

export type ToolCardEntityType = 'agent' | 'pipeline' | 'toolkit';

/** Ported from `ToolCard.jsx:293-299` (`entityType` useMemo). */
export function resolveEntityType(tool: AgentToolAssociation): ToolCardEntityType {
  if (tool.type !== 'application') return 'toolkit';
  return tool.agent_type === 'pipeline' ? 'pipeline' : 'agent';
}

/**
 * Ported from `ToolCard.jsx:379-389` (`dialogTitle` useMemo). A lookup
 * built at CALL time (not a module-scope `Record`) — `t()` must be called
 * on every render so it re-resolves as `i18n.language`/the loaded bundle
 * changes, matching every other `t()` call site in this cluster.
 */
export function resolveRemoveDialogTitle(entityType: ToolCardEntityType): string {
  const titleByEntity: Record<ToolCardEntityType, string> = {
    agent: t('agents.toolCard.removeAgentTitle', 'Remove agent?'),
    pipeline: t('agents.toolCard.removePipelineTitle', 'Remove pipeline?'),
    toolkit: t('agents.toolCard.removeToolkitTitle', 'Remove toolkit?'),
  };
  return titleByEntity[entityType];
}

/** Ported from `ToolCard.jsx:391-415` (`dialogContent` useMemo) — the trailing-sentence half only; `name` (bolded) is `DeleteEntityModal`'s own `name` prop, see `ToolCard.tsx`. */
export function resolveRemoveDialogSuffix(entityType: ToolCardEntityType, isAttachmentToolkit: boolean): string {
  if (entityType === 'agent') return t('agents.toolCard.removeAgentSuffix', ' agent?');
  if (entityType === 'pipeline') return t('agents.toolCard.removePipelineSuffix', ' pipeline?');
  if (isAttachmentToolkit) return t('agents.toolCard.removeAttachmentToolkitSuffix', ' toolkit, which is used to keep attached files?');
  return t('agents.toolCard.removeToolkitSuffix', ' toolkit?');
}

/** Ported from `ToolCard.jsx:97-101` (`mcpDisconnectedTip`). */
export function resolveMcpDisconnectedTip(toolName: string | undefined, isAuthorized: boolean): string {
  return isAuthorized ? t('agents.toolCard.mcpConnectedTip', 'The {{name}} mcp server is connected.', { name: toolName }) : t('agents.toolCard.mcpDisconnectedTip', 'The {{name}} mcp server is disconnected. Reconnect it to use.', { name: toolName });
}

/** Ported from `ToolCard.jsx:302` (`openTooltipText`). */
export function resolveOpenTooltipText(entityType: ToolCardEntityType, isMcp: boolean): string {
  const entity = entityType === 'toolkit' && isMcp ? 'mcp' : entityType;
  return t('agents.toolCard.openInNewTab', 'Open {{entity}} in new tab', { entity });
}

/** Ported from `ToolCard.jsx:585-586` (the SharePoint/OpenAPI delegated-login conditional slots — folded into one mutually-exclusive-by-`tool.type` slot for `ToolCardActionsCluster`'s `extraAuthSlot`). */
export function resolveExtraAuthSlot(toolType: string | undefined, delegatedAuth: ToolCardDelegatedAuthProps | undefined): ReactNode {
  if (toolType === 'sharepoint') return delegatedAuth?.sharepointLoginSlot;
  if (toolType === 'openapi') return delegatedAuth?.openApiLoginSlot;
  return undefined;
}

/**
 * Every small `tool`/`context`/`validation`/`delegatedAuth`/`disassociate`
 * -derived value `ToolCard` needs, resolved in ONE call. Consolidated here
 * (rather than as ~12 separate one-line derivations in `ToolCard.tsx`'s own
 * body) because each individual `?.`/`??` access — even wrapped in its own
 * `useMemo` — still appears at least once in `ToolCard`'s OWN function
 * scope via that `useMemo` call's dependency-array literal (a plain array
 * expression evaluated in the ENCLOSING scope, not inside the memoised
 * callback), so wrapping did not remove it from the `complexity` budget's
 * count the way moving the WHOLE computation here does.
 */
export interface ToolCardViewState {
  readonly isMcp: boolean;
  readonly mcpIsAuthorized: boolean;
  readonly isAttachmentToolkit: boolean;
  readonly isAgentOrPipeline: boolean;
  readonly isBlockedToolkit: boolean;
  readonly hasVariables: boolean;
  readonly projectId: string | number | undefined;
  readonly hasValidationIssue: boolean;
  readonly onRevalidate: (() => void) | undefined;
  readonly validationBanner: ReactNode;
  readonly selectedTools: readonly string[] | undefined;
  readonly isConfirmingRemove: boolean;
  readonly mcpLoginSlot: ReactNode;
  readonly mcpLogoutSlot: ReactNode;
  readonly duplicateTooltipTitle: string;
  readonly applicationId: string | number | undefined;
  readonly applicationVersionId: string | number | undefined;
}

/** First half of `resolveToolCardViewState`, split out purely to stay under the `complexity` budget itself (the consolidated function alone measured 22). */
function resolveToolFlags(tool: AgentToolAssociation, context: ToolCardContext): Pick<ToolCardViewState, 'isMcp' | 'isAttachmentToolkit' | 'isAgentOrPipeline' | 'isBlockedToolkit' | 'hasVariables' | 'applicationId' | 'applicationVersionId'> {
  const isAgentOrPipeline = tool.type === 'application';
  return {
    isMcp: !!tool.meta?.mcp || tool.type === 'mcp' || isPrebuildMcpType(tool.type),
    isAttachmentToolkit: !!tool.id && context.attachmentToolkitId === tool.id,
    isAgentOrPipeline,
    isBlockedToolkit: !isAgentOrPipeline && isToolkitTypeBlocked(tool.type, context.blockedToolkitTypes),
    hasVariables: (tool.variables?.length ?? 0) > 0,
    applicationId: tool.settings?.application_id,
    applicationVersionId: tool.settings?.application_version_id,
  };
}

/** Second half of `resolveToolCardViewState` — the `validation`/`delegatedAuth`/`disassociate`/`context`-derived fields. */
function resolveCallerSuppliedFlags(params: {
  readonly context: ToolCardContext;
  readonly disassociate: ToolCardDisassociateProps;
  readonly validation: ToolCardValidationProps | undefined;
  readonly delegatedAuth: ToolCardDelegatedAuthProps | undefined;
}): Pick<ToolCardViewState, 'mcpIsAuthorized' | 'projectId' | 'hasValidationIssue' | 'onRevalidate' | 'validationBanner' | 'isConfirmingRemove' | 'mcpLoginSlot' | 'mcpLogoutSlot'> {
  const { context, disassociate, validation, delegatedAuth } = params;
  return {
    mcpIsAuthorized: delegatedAuth?.mcpIsAuthorized ?? false,
    projectId: context.entityProjectId ?? context.selectedProjectId,
    hasValidationIssue: validation?.hasIssue ?? false,
    onRevalidate: validation?.onRevalidate,
    validationBanner: validation?.banner,
    isConfirmingRemove: disassociate.isDisassociating ?? false,
    mcpLoginSlot: delegatedAuth?.mcpLoginSlot,
    mcpLogoutSlot: delegatedAuth?.mcpLogoutSlot,
  };
}

export function resolveToolCardViewState(params: {
  readonly tool: AgentToolAssociation;
  readonly isDuplicate: boolean;
  readonly context: ToolCardContext;
  readonly disassociate: ToolCardDisassociateProps;
  readonly validation: ToolCardValidationProps | undefined;
  readonly delegatedAuth: ToolCardDelegatedAuthProps | undefined;
}): ToolCardViewState {
  const { tool, isDuplicate, context, disassociate, validation, delegatedAuth } = params;
  return {
    ...resolveToolFlags(tool, context),
    ...resolveCallerSuppliedFlags({ context, disassociate, validation, delegatedAuth }),
    selectedTools: tool.settings?.selected_tools,
    duplicateTooltipTitle: isDuplicate ? t('agents.toolCard.duplicateWarning', 'There are other tools of the same name and type, they may result in duplication and unpredictable results from agent.') : '',
  };
}

/** Ported from `ToolCard.jsx:540-555` (the "open in new tab" `IconButton`'s `onClick`/`title`/`disabled`). */
export function resolveOpenAction(params: { readonly onClick: () => void; readonly entityType: ToolCardEntityType; readonly isMcp: boolean; readonly disabled: boolean | undefined; readonly toolId: string | number | undefined; readonly applicationId: string | number | undefined }): ToolCardActionButtonConfig {
  const { onClick, entityType, isMcp, disabled, toolId, applicationId } = params;
  return { onClick, tooltip: resolveOpenTooltipText(entityType, isMcp), disabled: disabled || (!toolId && !applicationId) };
}

/** Ported from `ToolCard.jsx:557-570` (the "delete" `IconButton`'s `onClick`/`title`/`disabled`). */
export function resolveRemoveAction(params: { readonly onClick: () => void; readonly entityType: ToolCardEntityType; readonly disabled: boolean | undefined }): ToolCardActionButtonConfig {
  const { onClick, entityType, disabled } = params;
  return { onClick, tooltip: t('agents.toolCard.removeEntity', 'Remove {{entity}}', { entity: entityType }), disabled };
}

/**
 * Ported from `ToolCard.jsx:210-234` (`onOpenInNewTab`'s URL construction —
 * the callback itself, in `ToolCard.tsx`, only calls `window.open` with
 * this function's result). All-primitive params, deliberately: every
 * `tool.settings?.*`/`view.*` optional access is resolved ONCE, by the
 * caller, into a plain value passed in here — see `ToolCard.lib.ts`'s
 * module doc comment on `resolveToolCardViewState` for why that matters
 * for the `complexity` budget.
 */
export function buildOpenInNewTabUrl(params: {
  readonly isAgentOrPipeline: boolean;
  readonly applicationId: string | number | undefined;
  readonly applicationVersionId: string | number | undefined;
  readonly agentType: string | undefined;
  readonly toolId: string | number | undefined;
  readonly projectId: string | number | undefined;
  readonly viewMode: string;
  readonly toolkitName: string;
  readonly isMcp: boolean;
  readonly basename: string;
}): string | undefined {
  const { isAgentOrPipeline, applicationId, applicationVersionId, agentType, toolId, projectId, viewMode, toolkitName, isMcp, basename } = params;
  const baseUrl = `${window.location.protocol}//${window.location.host}`;

  if (isAgentOrPipeline) {
    if (!applicationId || !projectId) return undefined;
    const entityPath = agentType !== 'pipeline' ? 'agents' : 'pipelines';
    const versionSegment = applicationVersionId ? `/${applicationVersionId}` : '';
    return `${baseUrl}${basename}/${entityPath}/all/${applicationId}${versionSegment}?${SearchParams.ViewMode}=${viewMode}&name=${toolkitName}`;
  }

  if (!toolId) return undefined;
  const entityPath = isMcp ? 'mcps' : 'toolkits';
  return `${baseUrl}${basename}/${entityPath}/all/${toolId}?${SearchParams.ViewMode}=${viewMode}&name=${toolkitName}`;
}
