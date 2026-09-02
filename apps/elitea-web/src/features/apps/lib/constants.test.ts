import { describe, expect, it } from 'vitest';

import { BrandPack, DEFAULT_BRAND_PACK, docsLink } from '@/shared/brand';
import { i18n } from '@/shared/i18n';

import { APPLICATION_CATALOG_TYPES, REQUEST_STATUS, applicationCatalog } from './constants';

const APPLICATION_CATALOG = applicationCatalog();

describe('applicationCatalog', () => {
  it('has exactly the two baseline entries, in order, each with a real icon component', () => {
    expect(APPLICATION_CATALOG.map((entry) => entry.type)).toEqual(['wikis_Wikis', 'inventory']);
    expect(APPLICATION_CATALOG.map((entry) => entry.type)).toEqual([...APPLICATION_CATALOG_TYPES]);
    for (const entry of APPLICATION_CATALOG) {
      expect(entry.Icon).toBeDefined();
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('takes every user-visible string from the i18n bundle (ADR-0024 WP8)', () => {
    const [wikis, inventory] = APPLICATION_CATALOG;
    expect(wikis?.name).toBe(i18n.t('apps.catalog.wikis.name'));
    expect(wikis?.shortDescription).toBe(i18n.t('apps.catalog.wikis.shortDescription'));
    expect(wikis?.description).toBe(i18n.t('apps.catalog.wikis.description'));
    expect(wikis?.bestFor).toBe(i18n.t('apps.catalog.wikis.bestFor'));
    expect(wikis?.capabilities).toEqual([
      i18n.t('apps.catalog.wikis.capabilities.generation'),
      i18n.t('apps.catalog.wikis.capabilities.architecture'),
      i18n.t('apps.catalog.wikis.capabilities.qa'),
    ]);
    expect(inventory?.name).toBe(i18n.t('apps.catalog.inventory.name'));
    expect(inventory?.description).toBe(i18n.t('apps.catalog.inventory.description'));
    // Every key above is in en.json: i18next returns the KEY for a missing one.
    for (const key of ['apps.catalog.wikis.name', 'apps.catalog.inventory.bestFor']) {
      expect(i18n.exists(key)).toBe(true);
    }
  });

  it('names the Wikis entry after the feature, never after the engine behind it', () => {
    const serialised = JSON.stringify(
      APPLICATION_CATALOG.map(({ Icon: _icon, ...text }) => text),
    );
    expect(serialised).not.toMatch(/DeepWiki/);
    expect(APPLICATION_CATALOG[0]?.name).toBe('Wikis');
  });

  it('derives the documentation links from the brand pack', () => {
    // No pack given: the served/default pack, whose docs origin is the fallback today.
    expect(APPLICATION_CATALOG[0]?.documentation).toBe(docsLink('integrations/apps/wikis', DEFAULT_BRAND_PACK));
    expect(APPLICATION_CATALOG[1]?.documentation).toBe(docsLink('integrations/apps/inventory', DEFAULT_BRAND_PACK));

    // A tenant pack re-points both entries.
    const tenant = BrandPack.parse({
      ...DEFAULT_BRAND_PACK,
      product: { ...DEFAULT_BRAND_PACK.product, docsUrl: 'https://docs.contoso.example' },
    });
    expect(applicationCatalog(tenant).map((entry) => entry.documentation)).toEqual([
      'https://docs.contoso.example/integrations/apps/wikis',
      'https://docs.contoso.example/integrations/apps/inventory',
    ]);
  });
});

describe('REQUEST_STATUS', () => {
  it('has the four baseline states', () => {
    expect(REQUEST_STATUS).toEqual({
      NONE: 'none',
      PENDING: 'pending',
      APPROVED: 'approved',
      REJECTED: 'rejected',
    });
  });
});
