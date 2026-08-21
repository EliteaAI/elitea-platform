/**
 * DEFECT: `features/mcps/lib/oauthFlow.ts` joined the configured basename to
 * `/mcp-auth-callback` with no normalization. The shipped basename is `/app/`,
 * so the OAuth `redirect_uri` became `https://host/app//mcp-auth-callback`.
 * An authorization server compares that URI as a plain string (RFC 6749
 * 3.1.2.3), so it never matched the registered callback and the flow failed
 * with `redirect_uri_mismatch`.
 */
import { describe, expect, it } from 'vitest';

import { normalizeBasename } from './basename';

describe('normalizeBasename', () => {
  it('drops the trailing slash the shipped default carries', () => {
    expect(normalizeBasename('/app/')).toBe('/app');
  });

  it('treats the root basename as empty', () => {
    expect(normalizeBasename('/')).toBe('');
    expect(normalizeBasename('')).toBe('');
  });

  it('adds the leading slash a relative value is missing', () => {
    expect(normalizeBasename('app/')).toBe('/app');
    expect(normalizeBasename('app')).toBe('/app');
  });

  it('collapses repeated trailing slashes', () => {
    expect(normalizeBasename('/app///')).toBe('/app');
  });

  it('keeps a nested basename intact', () => {
    expect(normalizeBasename('/ui/app/')).toBe('/ui/app');
  });
});
