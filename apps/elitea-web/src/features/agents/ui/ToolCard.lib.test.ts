import { describe, expect, it, vi } from 'vitest';

import { buildOpenInNewTabUrl, normalizeAvailableToolOptions, resolveEntityType, resolveExtraAuthSlot, resolveMcpDisconnectedTip, resolveOpenAction, resolveOpenTooltipText, resolveRemoveAction, resolveRemoveDialogSuffix, resolveRemoveDialogTitle, resolveToolCardViewState, resolveToolkitName } from './ToolCard.lib';

describe('resolveToolkitName', () => {
  it('uses the tool name for an application-type tool, falling back to "Unnamed"', () => {
    expect(resolveToolkitName({ type: 'application', name: 'My Agent' }, undefined)).toBe('My Agent');
    expect(resolveToolkitName({ type: 'application', name: '' }, undefined)).toBe('Unnamed');
  });

  it('falls back through elitea_title > name > toolkit_name > configuration_title > capitalized type > schema resolver > "Toolkit"', () => {
    expect(resolveToolkitName({ type: 'github', elitea_title: 'A' }, undefined)).toBe('A');
    expect(resolveToolkitName({ type: 'github', name: 'B' }, undefined)).toBe('B');
    expect(resolveToolkitName({ type: 'github', toolkit_name: 'C' }, undefined)).toBe('C');
    expect(resolveToolkitName({ type: 'github', settings: { configuration_title: 'D' } }, undefined)).toBe('D');
    expect(resolveToolkitName({ type: 'github' }, undefined)).toBe('Github');
    expect(resolveToolkitName({ type: undefined }, () => 'FromSchema')).toBe('FromSchema');
    expect(resolveToolkitName({ type: undefined }, undefined)).toBe('Toolkit');
  });
});

describe('normalizeAvailableToolOptions', () => {
  it('title-cases and underscore-replaces plain string entries', () => {
    expect(normalizeAvailableToolOptions(['create_issue'])).toEqual([{ label: 'Create issue', value: 'create_issue' }]);
  });

  it('resolves object entries by value/name/label, dropping entries with no usable name', () => {
    expect(normalizeAvailableToolOptions([{ value: 'x', label: 'Custom X' }, { name: 'y' }, { label: '   ' }])).toEqual([
      { label: 'Custom X', value: 'x' },
      { label: 'Y', value: 'y' },
    ]);
  });
});

describe('resolveEntityType', () => {
  it('is "toolkit" for a non-application tool', () => {
    expect(resolveEntityType({ type: 'github' })).toBe('toolkit');
  });

  it('is "pipeline" or "agent" for an application tool, by agent_type', () => {
    expect(resolveEntityType({ type: 'application', agent_type: 'pipeline' })).toBe('pipeline');
    expect(resolveEntityType({ type: 'application', agent_type: undefined })).toBe('agent');
  });
});

describe('resolveRemoveDialogTitle / resolveRemoveDialogSuffix', () => {
  it('gives distinct copy per entity type', () => {
    expect(resolveRemoveDialogTitle('agent')).toBe('Remove agent?');
    expect(resolveRemoveDialogTitle('pipeline')).toBe('Remove pipeline?');
    expect(resolveRemoveDialogTitle('toolkit')).toBe('Remove toolkit?');
  });

  it('the toolkit suffix depends on isAttachmentToolkit; agent/pipeline suffixes do not', () => {
    expect(resolveRemoveDialogSuffix('agent', true)).toBe(' agent?');
    expect(resolveRemoveDialogSuffix('pipeline', false)).toBe(' pipeline?');
    expect(resolveRemoveDialogSuffix('toolkit', true)).toBe(' toolkit, which is used to keep attached files?');
    expect(resolveRemoveDialogSuffix('toolkit', false)).toBe(' toolkit?');
  });
});

describe('resolveMcpDisconnectedTip', () => {
  it('varies by authorization state', () => {
    expect(resolveMcpDisconnectedTip('My MCP', true)).toBe('The My MCP mcp server is connected.');
    expect(resolveMcpDisconnectedTip('My MCP', false)).toBe('The My MCP mcp server is disconnected. Reconnect it to use.');
  });
});

describe('resolveOpenTooltipText', () => {
  it('uses "mcp" as the entity noun for an mcp-flavoured toolkit, otherwise the entity type', () => {
    expect(resolveOpenTooltipText('toolkit', true)).toBe('Open mcp in new tab');
    expect(resolveOpenTooltipText('toolkit', false)).toBe('Open toolkit in new tab');
    expect(resolveOpenTooltipText('agent', true)).toBe('Open agent in new tab');
  });
});

describe('resolveExtraAuthSlot', () => {
  it('returns the sharepoint slot only for a sharepoint tool, the openapi slot only for an openapi tool, else undefined', () => {
    expect(resolveExtraAuthSlot('sharepoint', { sharepointLoginSlot: 'sp' })).toBe('sp');
    expect(resolveExtraAuthSlot('openapi', { openApiLoginSlot: 'oa' })).toBe('oa');
    expect(resolveExtraAuthSlot('github', { sharepointLoginSlot: 'sp', openApiLoginSlot: 'oa' })).toBeUndefined();
  });
});

describe('resolveOpenAction / resolveRemoveAction', () => {
  it('open action is disabled when explicitly disabled, or when there is neither a tool id nor an application id', () => {
    const onClick = vi.fn();
    expect(resolveOpenAction({ onClick, entityType: 'toolkit', isMcp: false, disabled: true, toolId: 't', applicationId: undefined }).disabled).toBe(true);
    expect(resolveOpenAction({ onClick, entityType: 'toolkit', isMcp: false, disabled: false, toolId: undefined, applicationId: undefined }).disabled).toBe(true);
    expect(resolveOpenAction({ onClick, entityType: 'toolkit', isMcp: false, disabled: false, toolId: 't', applicationId: undefined }).disabled).toBe(false);
  });

  it('remove action forwards the caller-computed disabled flag verbatim and builds an entity-scoped tooltip', () => {
    const onClick = vi.fn();
    const action = resolveRemoveAction({ onClick, entityType: 'pipeline', disabled: true });
    expect(action).toEqual({ onClick, tooltip: 'Remove pipeline', disabled: true });
  });
});

describe('resolveToolCardViewState', () => {
  const baseParams = {
    tool: { id: 't1', type: 'github', settings: {} },
    isDuplicate: false,
    context: { viewMode: 'Owner' },
    disassociate: { onDisassociateTool: vi.fn() },
    validation: undefined,
    delegatedAuth: undefined,
  };

  it('classifies mcp-flavoured tools (meta.mcp, type "mcp", and prebuilt mcp_* types)', () => {
    expect(resolveToolCardViewState({ ...baseParams, tool: { type: 'github', meta: { mcp: true } } }).isMcp).toBe(true);
    expect(resolveToolCardViewState({ ...baseParams, tool: { type: 'mcp' } }).isMcp).toBe(true);
    expect(resolveToolCardViewState({ ...baseParams, tool: { type: 'mcp_github' } }).isMcp).toBe(true);
    expect(resolveToolCardViewState({ ...baseParams, tool: { type: 'github' } }).isMcp).toBe(false);
  });

  it('isAttachmentToolkit is true only when tool.id matches context.attachmentToolkitId', () => {
    expect(resolveToolCardViewState({ ...baseParams, tool: { id: 'att', type: 'artifact' }, context: { viewMode: 'Owner', attachmentToolkitId: 'att' } }).isAttachmentToolkit).toBe(true);
    expect(resolveToolCardViewState({ ...baseParams, tool: { id: 'other', type: 'artifact' }, context: { viewMode: 'Owner', attachmentToolkitId: 'att' } }).isAttachmentToolkit).toBe(false);
  });

  it('isBlockedToolkit only applies to non-agent/pipeline tools on the blocklist', () => {
    const blocked = resolveToolCardViewState({ ...baseParams, tool: { type: 'github' }, context: { viewMode: 'Owner', blockedToolkitTypes: ['github'] } });
    expect(blocked.isBlockedToolkit).toBe(true);
    const agentNeverBlocked = resolveToolCardViewState({ ...baseParams, tool: { type: 'application' }, context: { viewMode: 'Owner', blockedToolkitTypes: ['application'] } });
    expect(agentNeverBlocked.isBlockedToolkit).toBe(false);
  });

  it('defaults validation/delegatedAuth-derived fields safely when both are undefined', () => {
    const view = resolveToolCardViewState(baseParams);
    expect(view.hasValidationIssue).toBe(false);
    expect(view.mcpIsAuthorized).toBe(false);
    expect(view.isConfirmingRemove).toBe(false);
    expect(view.onRevalidate).toBeUndefined();
    expect(view.mcpLoginSlot).toBeUndefined();
  });

  it('projectId prefers entityProjectId over selectedProjectId', () => {
    expect(resolveToolCardViewState({ ...baseParams, context: { viewMode: 'Owner', entityProjectId: 'e', selectedProjectId: 's' } }).projectId).toBe('e');
    expect(resolveToolCardViewState({ ...baseParams, context: { viewMode: 'Owner', selectedProjectId: 's' } }).projectId).toBe('s');
  });

  it('duplicateTooltipTitle is empty unless isDuplicate is true', () => {
    expect(resolveToolCardViewState({ ...baseParams, isDuplicate: false }).duplicateTooltipTitle).toBe('');
    expect(resolveToolCardViewState({ ...baseParams, isDuplicate: true }).duplicateTooltipTitle).not.toBe('');
  });
});

describe('buildOpenInNewTabUrl', () => {
  const common = { viewMode: 'owner', toolkitName: 'GitHub', basename: '' };

  it('builds a toolkits URL for a plain toolkit tool', () => {
    const url = buildOpenInNewTabUrl({ ...common, isAgentOrPipeline: false, applicationId: undefined, applicationVersionId: undefined, agentType: undefined, toolId: 42, projectId: 'p', isMcp: false });
    expect(url).toBe('http://localhost:3000/toolkits/all/42?viewMode=owner&name=GitHub');
  });

  it('builds an mcps URL for a plain mcp tool', () => {
    const url = buildOpenInNewTabUrl({ ...common, isAgentOrPipeline: false, applicationId: undefined, applicationVersionId: undefined, agentType: undefined, toolId: 7, projectId: 'p', isMcp: true });
    expect(url).toBe('http://localhost:3000/mcps/all/7?viewMode=owner&name=GitHub');
  });

  it('returns undefined for a plain toolkit with no id', () => {
    expect(buildOpenInNewTabUrl({ ...common, isAgentOrPipeline: false, applicationId: undefined, applicationVersionId: undefined, agentType: undefined, toolId: undefined, projectId: 'p', isMcp: false })).toBeUndefined();
  });

  it('builds an agents URL (with version segment) for an agent-type sub-application', () => {
    const url = buildOpenInNewTabUrl({ ...common, isAgentOrPipeline: true, applicationId: 7, applicationVersionId: 9, agentType: undefined, toolId: 't', projectId: 'p', isMcp: false });
    expect(url).toBe('http://localhost:3000/agents/all/7/9?viewMode=owner&name=GitHub');
  });

  it('builds a pipelines URL (no version segment) for a pipeline-type sub-application with no version id', () => {
    const url = buildOpenInNewTabUrl({ ...common, isAgentOrPipeline: true, applicationId: 7, applicationVersionId: undefined, agentType: 'pipeline', toolId: 't', projectId: 'p', isMcp: false });
    expect(url).toBe('http://localhost:3000/pipelines/all/7?viewMode=owner&name=GitHub');
  });

  it('returns undefined for an agent/pipeline tool missing an applicationId or a projectId', () => {
    expect(buildOpenInNewTabUrl({ ...common, isAgentOrPipeline: true, applicationId: undefined, applicationVersionId: undefined, agentType: undefined, toolId: 't', projectId: 'p', isMcp: false })).toBeUndefined();
    expect(buildOpenInNewTabUrl({ ...common, isAgentOrPipeline: true, applicationId: 7, applicationVersionId: undefined, agentType: undefined, toolId: 't', projectId: undefined, isMcp: false })).toBeUndefined();
  });
});
