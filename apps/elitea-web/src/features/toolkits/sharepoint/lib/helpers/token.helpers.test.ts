import { describe, expect, it } from 'vitest';

import { getSharepointConnectionTokenKey } from './token.helpers';

describe('getSharepointConnectionTokenKey', () => {
  it('composes configUuid:oauthEndpoint when both are present', () => {
    expect(
      getSharepointConnectionTokenKey({ oauthEndpoint: 'https://login.microsoftonline.com/tenant', configUuid: 'uuid-1' }),
    ).toBe('uuid-1:https://login.microsoftonline.com/tenant');
  });

  it('falls back to the bare oauthEndpoint when configUuid is absent', () => {
    expect(getSharepointConnectionTokenKey({ oauthEndpoint: 'https://login.microsoftonline.com/tenant' })).toBe(
      'https://login.microsoftonline.com/tenant',
    );
  });

  it('composes configUuid:siteUrl when oauthEndpoint is absent but both configUuid and siteUrl are present', () => {
    expect(getSharepointConnectionTokenKey({ configUuid: 'uuid-1', siteUrl: 'https://contoso.sharepoint.com' })).toBe(
      'uuid-1:https://contoso.sharepoint.com',
    );
  });

  it('falls back to the bare siteUrl when configUuid is absent', () => {
    expect(getSharepointConnectionTokenKey({ siteUrl: 'https://contoso.sharepoint.com' })).toBe(
      'https://contoso.sharepoint.com',
    );
  });

  it('returns undefined when nothing is provided', () => {
    expect(getSharepointConnectionTokenKey({})).toBeUndefined();
  });

  it('prefers oauthEndpoint over siteUrl when both are present (no configUuid)', () => {
    expect(
      getSharepointConnectionTokenKey({
        oauthEndpoint: 'https://login.microsoftonline.com/tenant',
        siteUrl: 'https://contoso.sharepoint.com',
      }),
    ).toBe('https://login.microsoftonline.com/tenant');
  });
});
