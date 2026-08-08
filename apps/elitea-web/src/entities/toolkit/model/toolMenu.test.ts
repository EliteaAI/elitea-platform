import { describe, expect, it } from 'vitest';

import { mergeMcpToolkitTypeSchemas, nonMcpToolkitTypeSchemas, toolkitTypeMenuEntries } from './toolMenu';

describe('mergeMcpToolkitTypeSchemas', () => {
  it('returns mcpSchemas unchanged when toolkitSchemas has no mcp key', () => {
    const mcpSchemas = { my_server: { metadata: { label: 'My Server' } } };
    expect(mergeMcpToolkitTypeSchemas({}, mcpSchemas)).toBe(mcpSchemas);
  });

  it('layers an mcp entry with label "Remote MCP" when toolkitSchemas has one', () => {
    const toolkitSchemas = { mcp: { metadata: { label: 'MCP' }, type: 'mcp' } };
    const mcpSchemas = { my_server: { metadata: { label: 'My Server' } } };
    const result = mergeMcpToolkitTypeSchemas(toolkitSchemas, mcpSchemas);
    expect(result['my_server']).toBe(mcpSchemas['my_server']);
    expect(result['mcp']).toMatchObject({ type: 'mcp', metadata: { label: 'Remote MCP' } });
  });
});

describe('nonMcpToolkitTypeSchemas', () => {
  it('drops keys named "mcp", typed "mcp", or ending in "mcp"', () => {
    const schemas = {
      github: { type: 'github' },
      mcp: { type: 'mcp' },
      custom_mcp: { type: 'custom_mcp' },
      jira: { type: 'jira', metadata: {} },
    };
    const result = nonMcpToolkitTypeSchemas(schemas);
    expect(Object.keys(result).sort()).toEqual(['github', 'jira']);
  });
});

describe('toolkitTypeMenuEntries', () => {
  it('excludes hidden entries', () => {
    const schemas = { github: { metadata: { label: 'GitHub', hidden: true } } };
    expect(toolkitTypeMenuEntries(schemas)).toEqual([]);
  });

  it('excludes agent/application-keyed or labelled entries', () => {
    const schemas = {
      application: { metadata: { label: 'Agent' } },
      agent: { metadata: { label: 'Something' } },
    };
    expect(toolkitTypeMenuEntries(schemas)).toEqual([]);
  });

  it('excludes internal_tool-categorised entries', () => {
    const schemas = { internal_mcp: { metadata: { label: 'Internal', categories: ['internal_tool'] } } };
    expect(toolkitTypeMenuEntries(schemas)).toEqual([]);
  });

  it('keeps only non-application entries when isApplication is false (default)', () => {
    const schemas = {
      github: { metadata: { label: 'GitHub' } },
      sub_agent: { metadata: { label: 'Sub Agent', application: true } },
    };
    expect(toolkitTypeMenuEntries(schemas)).toEqual([{ key: 'github', label: 'GitHub', hasKnownLabel: true }]);
  });

  it('keeps only application entries when isApplication is true', () => {
    const schemas = {
      github: { metadata: { label: 'GitHub' } },
      sub_agent: { metadata: { label: 'Sub Agent', application: true } },
    };
    expect(toolkitTypeMenuEntries(schemas, { isApplication: true })).toEqual([{ key: 'sub_agent', label: 'Sub Agent', hasKnownLabel: true }]);
  });

  it('overrides the backend label with ToolTypes when a FE override exists', () => {
    const schemas = { jira: { metadata: { label: 'Jira Backend Label' } } };
    expect(toolkitTypeMenuEntries(schemas)).toEqual([{ key: 'jira', label: 'Jira', hasKnownLabel: true }]);
  });

  it('falls back to the backend label when there is no FE override', () => {
    const schemas = { totally_unknown_type: { metadata: { label: 'Backend Label' } } };
    expect(toolkitTypeMenuEntries(schemas)).toEqual([{ key: 'totally_unknown_type', label: 'Backend Label', hasKnownLabel: true }]);
  });

  it('sorts entries alphabetically by label, case-insensitively', () => {
    const schemas = {
      zephyr: { metadata: { label: 'Zephyr' } },
      github: { metadata: { label: 'GitHub' } },
      confluence: { metadata: { label: 'confluence' } },
    };
    expect(toolkitTypeMenuEntries(schemas).map((entry) => entry.key)).toEqual(['confluence', 'github', 'zephyr']);
  });
});
