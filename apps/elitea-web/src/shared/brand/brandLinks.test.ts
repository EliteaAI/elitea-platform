import { afterEach, describe, expect, it } from 'vitest';

import {
  FALLBACK_DOCS_URL,
  FALLBACK_SUPPORT_EMAIL,
  docsBaseUrl,
  docsLink,
  supportEmail,
  supportUrl,
} from './brandLinks';
import { BRAND_PACK_GLOBAL } from './channelC';
import { BrandPack } from './schema';
import { DEFAULT_BRAND_PACK } from './tokens';

/** A tenant pack that states every contact field. */
const tenantPack = BrandPack.parse({
  ...DEFAULT_BRAND_PACK,
  id: 'contoso',
  product: {
    ...DEFAULT_BRAND_PACK.product,
    docsUrl: 'https://docs.contoso.example/',
    supportUrl: 'https://help.contoso.example/tickets',
    supportEmail: 'help@contoso.example',
    senderName: 'Contoso Machina',
  },
});

const globalWindow = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete globalWindow[BRAND_PACK_GLOBAL];
});

describe('brand pack schema — the WP8 contact fields', () => {
  it('accepts and preserves product.supportEmail and product.senderName', () => {
    expect(tenantPack.product.supportEmail).toBe('help@contoso.example');
    expect(tenantPack.product.senderName).toBe('Contoso Machina');
  });

  it('rejects a supportEmail that is not an e-mail address', () => {
    const result = BrandPack.safeParse({
      ...DEFAULT_BRAND_PACK,
      product: { ...DEFAULT_BRAND_PACK.product, supportEmail: 'not-an-address' },
    });
    expect(result.success).toBe(false);
  });

  it('leaves both fields absent (not null) when a pack does not state them', () => {
    expect('supportEmail' in DEFAULT_BRAND_PACK.product).toBe(false);
    expect('senderName' in DEFAULT_BRAND_PACK.product).toBe(false);
  });
});

describe('docsLink', () => {
  it('uses the given pack’s docsUrl, joining with exactly one slash', () => {
    expect(docsLink('integrations/apps/wikis', tenantPack)).toBe(
      'https://docs.contoso.example/integrations/apps/wikis',
    );
    expect(docsLink('/integrations/apps/wikis', tenantPack)).toBe(
      'https://docs.contoso.example/integrations/apps/wikis',
    );
  });

  it('returns the origin alone for an empty suffix', () => {
    expect(docsLink('', tenantPack)).toBe('https://docs.contoso.example');
    expect(docsBaseUrl(tenantPack)).toBe('https://docs.contoso.example');
  });

  it('falls back to the shipped literal when neither the pack nor the default states docsUrl', () => {
    // The compiled default pack states no docsUrl today; if it ever does,
    // this test must move to asserting that value instead of the literal.
    expect(DEFAULT_BRAND_PACK.product.docsUrl).toBeUndefined();
    expect(docsLink('integrations/apps/inventory', DEFAULT_BRAND_PACK)).toBe(
      `${FALLBACK_DOCS_URL}/integrations/apps/inventory`,
    );
  });

  it('reads the served pack from window when no pack is given', () => {
    globalWindow[BRAND_PACK_GLOBAL] = tenantPack;
    expect(docsLink('x')).toBe('https://docs.contoso.example/x');

    delete globalWindow[BRAND_PACK_GLOBAL];
    expect(docsLink('x')).toBe(`${FALLBACK_DOCS_URL}/x`);
  });
});

describe('supportEmail / supportUrl', () => {
  it('prefer the pack’s own values', () => {
    expect(supportEmail(tenantPack)).toBe('help@contoso.example');
    expect(supportUrl(tenantPack)).toBe('https://help.contoso.example/tickets');
  });

  it('fall back to the shipped address, and to a mailto: of it for the URL', () => {
    expect(supportEmail(DEFAULT_BRAND_PACK)).toBe(FALLBACK_SUPPORT_EMAIL);
    expect(supportUrl(DEFAULT_BRAND_PACK)).toBe(`mailto:${FALLBACK_SUPPORT_EMAIL}`);
  });

  it('build the mailto: from the pack’s e-mail when it states an e-mail but no URL', () => {
    const emailOnly = BrandPack.parse({
      ...DEFAULT_BRAND_PACK,
      product: { ...DEFAULT_BRAND_PACK.product, supportEmail: 'help@contoso.example' },
    });
    expect(supportUrl(emailOnly)).toBe('mailto:help@contoso.example');
  });

  it('read the served pack from window when no pack is given', () => {
    globalWindow[BRAND_PACK_GLOBAL] = tenantPack;
    expect(supportEmail()).toBe('help@contoso.example');
    expect(supportUrl()).toBe('https://help.contoso.example/tickets');
  });
});
