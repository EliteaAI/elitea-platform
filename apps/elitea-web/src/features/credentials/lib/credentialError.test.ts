import { describe, expect, it } from 'vitest';

import { extractInformationFromCredentialError } from './credentialError';

describe('extractInformationFromCredentialError', () => {
  it('returns no errors when the message is not a string', () => {
    const result = extractInformationFromCredentialError({
      error: {},
      schemaProperties: { api_key: { title: 'API Key' } },
      settings: {},
    });
    expect(result.newErrors).toEqual({});
  });

  it('matches a field by its schema title', () => {
    const result = extractInformationFromCredentialError({
      error: { data: { message: 'Invalid API Key provided' } },
      schemaProperties: { api_key: { title: 'API Key' } },
      settings: {},
    });
    expect(result.newErrors).toEqual({ api_key: 'Invalid API Key provided' });
  });

  it('matches a field by its schema description', () => {
    const result = extractInformationFromCredentialError({
      error: { data: { message: 'the base url is unreachable' } },
      schemaProperties: { endpoint: { description: 'Base URL' } },
      settings: {},
    });
    expect(result.newErrors).toEqual({ endpoint: 'the base url is unreachable' });
  });

  it('matches a field by its own current string value', () => {
    const result = extractInformationFromCredentialError({
      error: { data: { message: 'value acme-corp already exists' } },
      schemaProperties: { org: {} },
      settings: { org: 'acme-corp' },
    });
    expect(result.newErrors).toEqual({ org: 'value acme-corp already exists' });
  });

  it('matches a field by its own key name', () => {
    const result = extractInformationFromCredentialError({
      error: { data: { message: 'region is invalid' } },
      schemaProperties: { region: {} },
      settings: {},
    });
    expect(result.newErrors).toEqual({ region: 'region is invalid' });
  });

  it('matches a secret-shaped field on the word "authentication"', () => {
    const result = extractInformationFromCredentialError({
      error: { data: { message: 'authentication failed' } },
      schemaProperties: { api_key: { type: 'string' }, base_url: { type: 'string' } },
      settings: {},
    });
    expect(result.newErrors).toEqual({ api_key: 'authentication failed' });
  });

  it('matches a url-named field on the word "url"', () => {
    const result = extractInformationFromCredentialError({
      error: { data: { message: 'the url is malformed' } },
      schemaProperties: { base_url: { type: 'string' } },
      settings: {},
    });
    expect(result.newErrors).toEqual({ base_url: 'the url is malformed' });
  });

  it('falls back to flagging every url-named field when nothing else matched', () => {
    const result = extractInformationFromCredentialError({
      error: { data: { message: 'something unrelated went wrong' } },
      schemaProperties: { base_url: {}, api_key: {} },
      settings: {},
    });
    expect(result.newErrors).toEqual({ base_url: 'something unrelated went wrong' });
  });

  it('produces no errors when nothing matches and there is no url field', () => {
    const result = extractInformationFromCredentialError({
      error: { data: { message: 'something unrelated went wrong' } },
      schemaProperties: { api_key: {} },
      settings: {},
    });
    expect(result.newErrors).toEqual({});
  });
});
