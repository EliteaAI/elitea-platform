import { describe, expect, it } from 'vitest';

import { isLegacyOpenApiToolkit, normalizeLegacyOpenApiToolkit } from './legacyOpenApiMigration.helpers';
import type { LegacyOpenApiToolkitLike, NormalisedOpenApiToolkitSettings } from './legacyOpenApiMigration.helpers';

/**
 * `normalizeLegacyOpenApiToolkit`'s return type is a union (unchanged input
 * vs. the normalised shape) since the function itself can't statically know
 * which branch a given call takes. Every test below passes a genuinely
 * legacy-shaped input, so the normalised branch always wins at runtime —
 * this narrows the STATIC type to match, rather than sprinkling `as` casts
 * at every call site.
 */
function normalise(toolkit: LegacyOpenApiToolkitLike): { readonly settings: NormalisedOpenApiToolkitSettings; readonly [key: string]: unknown } {
  return normalizeLegacyOpenApiToolkit(toolkit) as { readonly settings: NormalisedOpenApiToolkitSettings; readonly [key: string]: unknown };
}

describe('isLegacyOpenApiToolkit', () => {
  it('is false for a non-openapi toolkit regardless of settings', () => {
    expect(isLegacyOpenApiToolkit({ type: 'github', settings: { authentication: { type: 'api_key' } } })).toBe(false);
  });

  it('is false for an openapi toolkit with only new-format fields', () => {
    expect(isLegacyOpenApiToolkit({ type: 'openapi', settings: { spec: '...', selected_tools: ['a'] } })).toBe(false);
  });

  it('is true when settings carry the old authentication block', () => {
    expect(isLegacyOpenApiToolkit({ type: 'openapi', settings: { authentication: { type: 'api_key' } } })).toBe(true);
  });

  it('is true when settings carry the old schema_settings field', () => {
    expect(isLegacyOpenApiToolkit({ type: 'openapi', settings: { schema_settings: '{}' } })).toBe(true);
  });

  it('is false when a toolkit has no settings at all', () => {
    expect(isLegacyOpenApiToolkit({ type: 'openapi' })).toBe(false);
  });

  it('is false for undefined input', () => {
    expect(isLegacyOpenApiToolkit(undefined)).toBe(false);
  });
});

describe('normalizeLegacyOpenApiToolkit', () => {
  it('returns the toolkit unchanged (by reference) when not legacy-shaped', () => {
    const toolkit = { type: 'openapi', settings: { spec: 'x', selected_tools: ['a'] } };
    expect(normalizeLegacyOpenApiToolkit(toolkit)).toBe(toolkit);
  });

  it('converts schema_settings to spec', () => {
    const result = normalise({
      type: 'openapi',
      settings: { schema_settings: '{"paths":{}}', authentication: { type: 'api_key' } },
    });
    expect(result.settings.spec).toBe('{"paths":{}}');
  });

  it('falls back to an existing spec field when schema_settings is absent', () => {
    const result = normalise({
      type: 'openapi',
      settings: { authentication: { type: 'api_key' }, spec: 'existing-spec' },
    });
    expect(result.settings.spec).toBe('existing-spec');
  });

  it('falls back to an existing spec field when schema_settings is an empty string (does not treat empty string as defined)', () => {
    const result = normalise({
      type: 'openapi',
      settings: { schema_settings: '', authentication: { type: 'api_key' }, spec: 'existing-spec' },
    });
    expect(result.settings.spec).toBe('existing-spec');
  });

  it('falls back to an empty string when neither schema_settings nor spec is present', () => {
    const result = normalise({
      type: 'openapi',
      settings: { authentication: { type: 'api_key' } },
    });
    expect(result.settings.spec).toBe('');
  });

  it('normalises object-shaped selected_tools entries to their .name', () => {
    const result = normalise({
      type: 'openapi',
      settings: {
        schema_settings: '{}',
        authentication: { type: 'api_key' },
        selected_tools: [{ name: 'get_users' }, 'raw_string_tool', { name: 'post_users' }],
      },
    });
    expect(result.settings.selected_tools).toEqual(['get_users', 'raw_string_tool', 'post_users']);
  });

  it('drops selected_tools entries with neither a usable name nor a string shape', () => {
    const result = normalise({
      type: 'openapi',
      settings: { schema_settings: '{}', authentication: {}, selected_tools: [null, {}] },
    });
    expect(result.settings.selected_tools).toEqual([]);
  });

  it('drops the authentication field entirely', () => {
    const result = normalise({
      type: 'openapi',
      settings: { schema_settings: '{}', authentication: { type: 'api_key', settings: { api_key: 'secret' } } },
    });
    expect(result.settings).not.toHaveProperty('authentication');
  });

  it('preserves other settings fields and top-level fields', () => {
    const result = normalise({
      type: 'openapi',
      name: 'my-toolkit',
      settings: { schema_settings: '{}', authentication: {}, custom_field: 'kept' },
    });
    expect(result['name']).toBe('my-toolkit');
    expect(result.settings['custom_field']).toBe('kept');
  });
});
