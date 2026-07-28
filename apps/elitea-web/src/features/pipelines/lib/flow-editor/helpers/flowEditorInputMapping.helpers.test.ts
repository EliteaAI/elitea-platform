import { describe, expect, it } from 'vitest';

import {
  getDefaultInputMappingOfTool,
  getEnumList,
  getInputMappingDefaultValue,
  getRequiredInputsAndTooltips,
} from './flowEditorInputMapping.helpers';

describe('getInputMappingDefaultValue', () => {
  it('returns the first enum value for a non-array type with an enum', () => {
    expect(getInputMappingDefaultValue(['a', 'b'], 'string', {}, 'key')).toBe('a');
  });

  it('returns [] for an array type even with an enum', () => {
    expect(getInputMappingDefaultValue(['a', 'b'], 'array', {}, 'key')).toEqual([]);
  });

  it('falls back to defaultValues[key], else empty string', () => {
    expect(getInputMappingDefaultValue(undefined, 'string', { key: 'preset' }, 'key')).toBe('preset');
    expect(getInputMappingDefaultValue(undefined, 'string', {}, 'key')).toBe('');
  });
});

describe('getEnumList', () => {
  it('fixed: returns the schema enum as-is', () => {
    expect(getEnumList('fixed', ['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('variable: maps input options to their values', () => {
    expect(getEnumList('variable', undefined, [{ value: 'x' }, { value: 'y' }])).toEqual(['x', 'y']);
  });

  it('anything else: empty array', () => {
    expect(getEnumList('other', ['a'], [])).toEqual([]);
  });
});

describe('getDefaultInputMappingOfTool', () => {
  it('builds a mapping from a tool schema, defaulting values by JSON-schema type', () => {
    const toolkitSchemas = {
      github: {
        properties: {
          selected_tools: {
            args_schemas: {
              create_issue: {
                properties: {
                  title: { type: 'string' },
                  count: { type: 'integer', default: 1 },
                  flag: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    };
    const result = getDefaultInputMappingOfTool(toolkitSchemas, 'create_issue', undefined, { type: 'github' });
    expect(result.mapping).toEqual({
      title: { type: 'fixed', value: '', enum: undefined },
      count: { type: 'fixed', value: 1, enum: undefined },
      flag: { type: 'fixed', value: false, enum: undefined },
    });
    expect(result.defaultValues).toEqual({ title: '', count: 1, flag: false });
  });

  it('preserves an existing mapping entry rather than resetting it', () => {
    const toolkitSchemas = {
      github: { properties: { selected_tools: { args_schemas: { create_issue: { properties: { title: { type: 'string' } } } } } } },
    };
    const existingMapping = { title: { type: 'variable' as const, value: 'some_var' } };
    const result = getDefaultInputMappingOfTool(toolkitSchemas, 'create_issue', existingMapping, { type: 'github' });
    expect(result.mapping['title']).toMatchObject({ type: 'variable', value: 'some_var' });
  });

  it('special-cases the "application" toolkit type into a task + agent-variables mapping', () => {
    const result = getDefaultInputMappingOfTool(undefined, undefined, undefined, {
      type: 'application',
      variables: [{ name: 'topic', value: 'default topic' }],
    });
    expect(result.mapping).toMatchObject({
      task: { type: 'fstring', value: '' },
      topic: { type: 'fixed', value: 'default topic' },
    });
    expect(result.mappingInfo?.['task']).toMatchObject({ type: 'fstring' });
  });

  it('returns the existing mapping unchanged when the tool schema cannot be resolved yet', () => {
    const result = getDefaultInputMappingOfTool(undefined, 'some_tool', { a: { type: 'fixed', value: 1 } }, { type: 'custom' });
    expect(result.mapping).toEqual({ a: { type: 'fixed', value: 1 } });
    expect(result.defaultValues).toEqual({});
  });

  it('extracts args_schema from available_mcp_tools for a remote MCP tool by value or label', () => {
    const toolkit = {
      type: 'mcp',
      meta: { mcp: true },
      settings: {
        available_mcp_tools: [
          { value: 'search', label: 'Search', args_schema: { properties: { query: { type: 'string' } } } },
        ],
      },
    };
    const result = getDefaultInputMappingOfTool(undefined, 'search', undefined, toolkit);
    expect(result.mapping).toHaveProperty('query');
  });
});

describe('getRequiredInputsAndTooltips', () => {
  it('special-cases "application" toolkit to require just `task`', () => {
    const result = getRequiredInputsAndTooltips(undefined, undefined, {
      type: 'application',
      settings: { variables: [{ name: 'topic' }] },
    });
    expect(result.required).toEqual(['task']);
    expect(result.tooltips?.['task']).toBeTypeOf('string');
    expect(result.tooltips?.['topic']).toBeTypeOf('string');
  });

  it('reads `required` off the resolved tool schema', () => {
    const toolkitTypes = {
      github: { properties: { selected_tools: { args_schemas: { create_issue: { required: ['title'] } } } } },
    };
    const result = getRequiredInputsAndTooltips(toolkitTypes, 'create_issue', { type: 'github' });
    expect(result.required).toEqual(['title']);
  });

  it('falls back to inputSchema.required for an MCP tool, else []', () => {
    const toolkit = {
      type: 'mcp',
      meta: { mcp: true },
      settings: { available_mcp_tools: [{ value: 'search', args_schema: { inputSchema: { required: ['query'] } } }] },
    };
    expect(getRequiredInputsAndTooltips(undefined, 'search', toolkit).required).toEqual(['query']);
    expect(getRequiredInputsAndTooltips(undefined, 'missing', { type: 'github' }).required).toEqual([]);
  });
});
