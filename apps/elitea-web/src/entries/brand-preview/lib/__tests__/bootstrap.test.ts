/**
 * The inline-JSON bootstrap (ADR-0024 WP9): valid, invalid and absent.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK } from '@/shared/brand';

import { INLINE_PACK_ELEMENT_ID, parseBrandPackText, readInlineBrandPack, validateBrandPack } from '../bootstrap';

function documentWith(body: string | undefined, type = 'application/json'): Pick<Document, 'getElementById'> {
  const doc = window.document.implementation.createHTMLDocument('');
  if (body !== undefined) {
    const script = doc.createElement('script');
    script.setAttribute('type', type);
    script.id = INLINE_PACK_ELEMENT_ID;
    script.textContent = body;
    doc.head.append(script);
  }
  return doc;
}

const tenantPack = { ...DEFAULT_BRAND_PACK, id: 'tenant-a', product: { ...DEFAULT_BRAND_PACK.product, name: 'Tenant A' } };

describe('readInlineBrandPack', () => {
  it('takes a valid inline pack and reports the inline source', () => {
    const result = readInlineBrandPack(documentWith(JSON.stringify(tenantPack)));
    expect(result.source).toBe('inline');
    expect(result.pack.id).toBe('tenant-a');
    expect(result.pack.product.name).toBe('Tenant A');
    expect(result.issues).toEqual([]);
  });

  it('falls back to the compiled default when the element is absent', () => {
    const result = readInlineBrandPack(documentWith(undefined));
    expect(result).toEqual({ source: 'default', pack: DEFAULT_BRAND_PACK, issues: [] });
  });

  it('treats an empty element as absent — the exporter has not filled it', () => {
    const result = readInlineBrandPack(documentWith('  \n '));
    expect(result).toEqual({ source: 'default', pack: DEFAULT_BRAND_PACK, issues: [] });
  });

  it('ignores an element whose type is not application/json', () => {
    const result = readInlineBrandPack(documentWith(JSON.stringify(tenantPack), 'text/plain'));
    expect(result.source).toBe('default');
    expect(result.issues).toEqual([]);
  });

  it('falls back with the verbatim issues when the inline pack fails the schema', () => {
    const broken = { ...tenantPack, shape: { ...tenantPack.shape, density: 'roomy' } };
    const result = readInlineBrandPack(documentWith(JSON.stringify(broken)));
    expect(result.source).toBe('default');
    expect(result.pack).toBe(DEFAULT_BRAND_PACK);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/^shape\.density: /);
  });

  it('falls back with a JSON issue when the inline text is not JSON', () => {
    const result = readInlineBrandPack(documentWith('{ not json'));
    expect(result.source).toBe('default');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/^not valid JSON: /);
  });
});

describe('validateBrandPack', () => {
  it('names every failing path, not just the first', () => {
    const broken = { ...tenantPack, id: '', typography: { ...tenantPack.typography, baseSize: 40 } };
    const result = validateBrandPack(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.startsWith('id: '))).toBe(true);
    expect(result.issues.some((issue) => issue.startsWith('typography.baseSize: '))).toBe(true);
  });

  it('refuses a schema-valid pack that the derivation cannot build', () => {
    // `text` as a leaf collides with the `text.primary` group — the case
    // channelC.ts documents; the schema cannot see it, the trial build can.
    const collision = { ...tenantPack, schemes: { ...tenantPack.schemes, light: { ...tenantPack.schemes.light, text: 'inherit' } } };
    const result = validateBrandPack(collision);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatch(/^cannot be built into a theme: /);
  });

  it('rejects an unknown top-level key (the schema is strict there)', () => {
    const result = validateBrandPack({ ...tenantPack, extra: 1 });
    expect(result.ok).toBe(false);
  });
});

describe('parseBrandPackText', () => {
  it('round-trips a serialised pack', () => {
    const result = parseBrandPackText(JSON.stringify(tenantPack));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack).toEqual(tenantPack);
  });
});
