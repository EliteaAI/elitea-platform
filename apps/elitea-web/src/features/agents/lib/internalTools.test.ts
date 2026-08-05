import { describe, expect, it, vi } from 'vitest';

import * as isMcpVisibleModule from '../api/useIsMcpVisible';
import * as selectedProjectIdModule from '../api/useSelectedProjectId';
import * as toolkitTypeSchemasModule from '../api/useToolkitTypeSchemas';

import { INTERNAL_TOOLS_LIST, INTERNAL_TOOL_ICONS, useAvailableInternalTools } from './internalTools';
import { renderHookWithProviders } from '../__tests__/testUtils';

describe('INTERNAL_TOOLS_LIST / INTERNAL_TOOL_ICONS', () => {
  it('every entry has a resolvable icon component', () => {
    for (const tool of INTERNAL_TOOLS_LIST) {
      expect(INTERNAL_TOOL_ICONS[tool.icon]).toBeDefined();
    }
  });

  it('includes the attachments tool, flagged agent-only', () => {
    const attachments = INTERNAL_TOOLS_LIST.find((tool) => tool.name === 'attachments');
    expect(attachments?.agentOnly).toBe(true);
  });

  it('includes image_generation, gated on the ImageGen toolkit type', () => {
    const imageGeneration = INTERNAL_TOOLS_LIST.find((tool) => tool.name === 'image_generation');
    expect(imageGeneration?.requiredToolkitType).toBe('ImageGenServiceProvider_ImageGen');
  });
});

describe('useAvailableInternalTools', () => {
  it('excludes agent-only tools when includeAgentOnly is not set', () => {
    vi.spyOn(selectedProjectIdModule, 'useSelectedProjectId').mockReturnValue('proj-1');
    vi.spyOn(toolkitTypeSchemasModule, 'useToolkitTypeSchemas').mockReturnValue({
      toolkitTypeSchemas: {},
      isFetching: false,
      isError: false,
      error: undefined,
    });
    vi.spyOn(isMcpVisibleModule, 'useIsMcpVisible').mockReturnValue(true);

    const { result } = renderHookWithProviders(() => useAvailableInternalTools());
    expect(result.current.some((tool) => tool.name === 'attachments')).toBe(false);
    vi.restoreAllMocks();
  });

  it('includes agent-only tools when includeAgentOnly is set', () => {
    vi.spyOn(selectedProjectIdModule, 'useSelectedProjectId').mockReturnValue('proj-1');
    vi.spyOn(toolkitTypeSchemasModule, 'useToolkitTypeSchemas').mockReturnValue({
      toolkitTypeSchemas: {},
      isFetching: false,
      isError: false,
      error: undefined,
    });
    vi.spyOn(isMcpVisibleModule, 'useIsMcpVisible').mockReturnValue(true);

    const { result } = renderHookWithProviders(() => useAvailableInternalTools({ includeAgentOnly: true }));
    expect(result.current.some((tool) => tool.name === 'attachments')).toBe(true);
    vi.restoreAllMocks();
  });

  it('excludes internal_mcp when MCP is not visible', () => {
    vi.spyOn(selectedProjectIdModule, 'useSelectedProjectId').mockReturnValue('proj-1');
    vi.spyOn(toolkitTypeSchemasModule, 'useToolkitTypeSchemas').mockReturnValue({
      toolkitTypeSchemas: {},
      isFetching: false,
      isError: false,
      error: undefined,
    });
    vi.spyOn(isMcpVisibleModule, 'useIsMcpVisible').mockReturnValue(false);

    const { result } = renderHookWithProviders(() => useAvailableInternalTools({ includeAgentOnly: true }));
    expect(result.current.some((tool) => tool.name === 'internal_mcp')).toBe(false);
    vi.restoreAllMocks();
  });

  it('excludes image_generation unless its required toolkit type is present in the schema map', () => {
    vi.spyOn(selectedProjectIdModule, 'useSelectedProjectId').mockReturnValue('proj-1');
    vi.spyOn(toolkitTypeSchemasModule, 'useToolkitTypeSchemas').mockReturnValue({
      toolkitTypeSchemas: {},
      isFetching: false,
      isError: false,
      error: undefined,
    });
    vi.spyOn(isMcpVisibleModule, 'useIsMcpVisible').mockReturnValue(true);

    const { result } = renderHookWithProviders(() => useAvailableInternalTools());
    expect(result.current.some((tool) => tool.name === 'image_generation')).toBe(false);
    vi.restoreAllMocks();
  });

  it('includes image_generation once its required toolkit type is present', () => {
    vi.spyOn(selectedProjectIdModule, 'useSelectedProjectId').mockReturnValue('proj-1');
    vi.spyOn(toolkitTypeSchemasModule, 'useToolkitTypeSchemas').mockReturnValue({
      toolkitTypeSchemas: { ImageGenServiceProvider_ImageGen: {} },
      isFetching: false,
      isError: false,
      error: undefined,
    });
    vi.spyOn(isMcpVisibleModule, 'useIsMcpVisible').mockReturnValue(true);

    const { result } = renderHookWithProviders(() => useAvailableInternalTools());
    expect(result.current.some((tool) => tool.name === 'image_generation')).toBe(true);
    vi.restoreAllMocks();
  });
});
