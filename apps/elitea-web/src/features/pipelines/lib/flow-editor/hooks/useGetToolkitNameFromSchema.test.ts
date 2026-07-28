import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';
import { cleanString, genToolkitName, useGetToolkitNameFromSchema } from './useGetToolkitNameFromSchema';

describe('cleanString', () => {
  it('strips everything but alphanumerics, underscore and hyphen', () => {
    expect(cleanString('My Toolkit! v2.0 (beta)')).toBe('MyToolkitv2_0beta');
  });

  it('returns empty string for non-string input', () => {
    expect(cleanString(undefined)).toBe('');
  });

  it('truncates to maxLength when given', () => {
    expect(cleanString('abcdefgh', 3)).toBe('abc');
  });
});

describe('genToolkitName', () => {
  const schemas: ToolkitTypeSchemaMap = {
    github: { properties: { repo_name: { toolkit_name: true } } },
  };

  it('uses the schema-flagged settings field when present and non-blank', () => {
    const name = genToolkitName({ type: 'github', name: 'fallback', settings: { repo_name: 'my-repo' } }, schemas);
    expect(name).toBe('my-repo');
  });

  it('falls back to name when the schema-flagged field is blank', () => {
    const name = genToolkitName({ type: 'github', name: 'fallback-name', settings: { repo_name: '' } }, schemas);
    expect(name).toBe('fallback-name');
  });

  it('falls back to name when the type has no schema', () => {
    const name = genToolkitName({ type: 'unknown', name: 'plain' }, schemas);
    expect(name).toBe('plain');
  });

  it('falls back to elitea_title then configuration_title when name is absent', () => {
    expect(genToolkitName({ type: 'unknown', settings: { elitea_title: 'Elitea Title' } }, schemas)).toBe('EliteaTitle');
    expect(genToolkitName({ type: 'unknown', settings: { configuration_title: 'Config Title' } }, schemas)).toBe('ConfigTitle');
  });
});

describe('useGetToolkitNameFromSchema', () => {
  const schemas: ToolkitTypeSchemaMap = {
    jira: {
      properties: { project_key: { toolkit_name: true }, selected_tools: { args_schemas: { search: {}, create: {} } } },
      required: ['url', 'project_key'],
      name_required: false,
    },
  };

  it('getToolkitNameFromSchema delegates to genToolkitName with the bound schemas', () => {
    const { result } = renderHook(() => useGetToolkitNameFromSchema(schemas));
    expect(result.current.getToolkitNameFromSchema({ type: 'jira', settings: { project_key: 'PROJ' } })).toBe('PROJ');
  });

  it('getToolkitNamePropFromSchema finds the toolkit_name-flagged property key', () => {
    const { result } = renderHook(() => useGetToolkitNameFromSchema(schemas));
    expect(result.current.getToolkitNamePropFromSchema('jira')).toBe('project_key');
    expect(result.current.getToolkitNamePropFromSchema('unknown')).toBeUndefined();
  });

  it('getRequiredProperties reads the schema required[] array', () => {
    const { result } = renderHook(() => useGetToolkitNameFromSchema(schemas));
    expect(result.current.getRequiredProperties('jira')).toEqual(['url', 'project_key']);
    expect(result.current.getRequiredProperties('unknown')).toEqual([]);
  });

  it('getSelectedTools reads the static args_schemas keys', () => {
    const { result } = renderHook(() => useGetToolkitNameFromSchema(schemas));
    expect(result.current.getSelectedTools('jira')).toEqual(['search', 'create']);
    expect(result.current.getSelectedTools(undefined)).toEqual([]);
  });

  it('isNameRequired defaults to true unless the schema sets name_required: false', () => {
    const { result } = renderHook(() => useGetToolkitNameFromSchema(schemas));
    expect(result.current.isNameRequired('jira')).toBe(false);
    expect(result.current.isNameRequired('unknown')).toBe(true);
  });

  it('every accessor tolerates undefined schemaOfTools', () => {
    const { result } = renderHook(() => useGetToolkitNameFromSchema(undefined));
    expect(result.current.getToolkitNameFromSchema({ type: 'jira', name: 'n' })).toBe('n');
    expect(result.current.getRequiredProperties('jira')).toEqual([]);
    expect(result.current.isNameRequired('jira')).toBe(true);
  });
});
