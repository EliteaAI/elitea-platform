import { describe, expect, it } from 'vitest';

import { applicationCatalog } from '../lib/constants';

import { buildCatalogApplication, filterApplicationSchemas, resolveApplicationAvailability } from './catalog';

const wikisEntry = applicationCatalog()[0]!;

describe('filterApplicationSchemas', () => {
  it('returns an empty map for undefined input', () => {
    expect(filterApplicationSchemas(undefined)).toEqual({});
  });

  it('keeps only schemas whose metadata.application is exactly true', () => {
    const schemas = {
      wikis_Wikis: { metadata: { application: true, label: 'Wikis' } },
      github: { metadata: { application: false } },
      jira: { metadata: {} },
      broken: 'not-an-object',
      noMetadata: {},
    };

    expect(filterApplicationSchemas(schemas)).toEqual({
      wikis_Wikis: { metadata: { application: true, label: 'Wikis' } },
    });
  });
});

describe('resolveApplicationAvailability', () => {
  it('is "configured" when the type already has an instance, regardless of canCreate', () => {
    expect(resolveApplicationAvailability(true, true)).toBe('configured');
    expect(resolveApplicationAvailability(true, false)).toBe('configured');
  });

  it('is "available" when not configured but a schema exists', () => {
    expect(resolveApplicationAvailability(false, true)).toBe('available');
  });

  it('is "byRequest" when neither configured nor creatable', () => {
    expect(resolveApplicationAvailability(false, false)).toBe('byRequest');
  });
});

describe('buildCatalogApplication', () => {
  it('marks a type with a registered application schema as creatable, using the schema label', () => {
    const schemas = { wikis_Wikis: { metadata: { application: true, label: 'DeepWiki' } } };
    const result = buildCatalogApplication(wikisEntry, schemas, new Set());

    expect(result).toMatchObject({
      type: 'wikis_Wikis',
      typeLabel: 'DeepWiki',
      canCreate: true,
      isConfigured: false,
      canRequest: false,
      availability: 'available',
    });
    expect(result.Icon).toBe(wikisEntry.Icon);
  });

  it('falls back to the entry name when the schema has no metadata.label', () => {
    const schemas = { wikis_Wikis: { metadata: { application: true } } };
    const result = buildCatalogApplication(wikisEntry, schemas, new Set());
    expect(result.typeLabel).toBe('Wikis');
  });

  it('falls back to the entry name when metadata.label is an empty string', () => {
    const schemas = { wikis_Wikis: { metadata: { application: true, label: '' } } };
    const result = buildCatalogApplication(wikisEntry, schemas, new Set());
    expect(result.typeLabel).toBe('Wikis');
  });

  it('marks an already-configured type as configured even without a schema', () => {
    const result = buildCatalogApplication(wikisEntry, {}, new Set(['wikis_Wikis']));
    expect(result).toMatchObject({
      canCreate: false,
      isConfigured: true,
      availability: 'configured',
    });
  });

  it('still marks an already-configured, non-creatable type as requestable, matching the old app\'s real render path (ApplicationCatalog.jsx:55) rather than its own unused hook field (useApplicationCatalogState.hooks.js:83)', () => {
    const result = buildCatalogApplication(wikisEntry, {}, new Set(['wikis_Wikis']));
    expect(result.canRequest).toBe(true);
  });

  it('marks a type with neither a schema nor a configured instance as requestable', () => {
    const result = buildCatalogApplication(wikisEntry, {}, new Set());
    expect(result).toMatchObject({
      canCreate: false,
      isConfigured: false,
      canRequest: true,
      availability: 'byRequest',
    });
  });

  it('treats a non-object schema value the same as "no schema" (defensive against a malformed map)', () => {
    const schemas = { wikis_Wikis: 'not-an-object' } as unknown as Record<string, Record<string, unknown>>;
    const result = buildCatalogApplication(wikisEntry, schemas, new Set());
    expect(result.canCreate).toBe(false);
    expect(result.typeLabel).toBe('Wikis');
  });

  it('populates the card tooltip field with the short blurb, not the entry\'s own longer description (baseline parity: useApplicationCatalogState.hooks.js:66 overwrote it the same way)', () => {
    const result = buildCatalogApplication(wikisEntry, {}, new Set());
    expect(result.description).toBe(wikisEntry.shortDescription);
    expect(result.description).not.toBe(wikisEntry.description);
  });
});
