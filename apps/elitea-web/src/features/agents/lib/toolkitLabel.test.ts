import { describe, expect, it } from 'vitest';

import { cleanString, genToolkitName } from './toolkitLabel';

describe('cleanString', () => {
  it('strips non-alphanumeric/underscore/hyphen characters', () => {
    expect(cleanString('Foo Bar! (Baz)')).toBe('FooBarBaz');
  });

  it('folds dots into underscores', () => {
    expect(cleanString('my.tool.name')).toBe('my_tool_name');
  });

  it('returns empty string for undefined', () => {
    expect(cleanString(undefined)).toBe('');
  });

  it('truncates to maxLength when given', () => {
    expect(cleanString('abcdefgh', 3)).toBe('abc');
  });

  it('does not truncate when maxLength is 0 (default)', () => {
    expect(cleanString('abcdefgh')).toBe('abcdefgh');
  });
});

describe('genToolkitName', () => {
  it('falls back to name when schema has no toolkit_name-flagged property', () => {
    const result = genToolkitName({ type: 'github', name: 'My GitHub' }, {});
    expect(result).toBe('MyGitHub');
  });

  it('falls back to settings.elitea_title when name is blank', () => {
    const result = genToolkitName({ type: 'github', name: '', settings: { elitea_title: 'Elitea Title' } }, {});
    expect(result).toBe('EliteaTitle');
  });

  it('falls back to settings.configuration_title when name and elitea_title are absent', () => {
    const result = genToolkitName({ type: 'github', settings: { configuration_title: 'Config Title' } }, undefined);
    expect(result).toBe('ConfigTitle');
  });

  it('returns empty string when nothing is available', () => {
    expect(genToolkitName({ type: 'github' }, {})).toBe('');
  });

  it('prefers the schema-flagged toolkit_name property value over name/settings fallback', () => {
    const schemaOfTools = {
      github: {
        properties: {
          repo_name: { toolkit_name: true },
          other: {},
        },
      },
    };
    const result = genToolkitName({ type: 'github', name: 'Fallback Name', settings: { repo_name: 'My Repo' } }, schemaOfTools);
    expect(result).toBe('MyRepo');
  });

  it('falls back to name when the flagged property is present but blank on settings', () => {
    const schemaOfTools = {
      github: {
        properties: {
          repo_name: { toolkit_name: true },
        },
      },
    };
    const result = genToolkitName({ type: 'github', name: 'Fallback Name', settings: { repo_name: '' } }, schemaOfTools);
    expect(result).toBe('FallbackName');
  });

  it('handles a tool with no type (schema lookup skipped)', () => {
    const result = genToolkitName({ name: 'No Type Tool' }, { github: { properties: {} } });
    expect(result).toBe('NoTypeTool');
  });
});
