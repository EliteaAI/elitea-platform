import { describe, expect, it } from 'vitest';

import { toAbsoluteApiUrl, toOpenAiBaseUrl } from './api-url';

const ORIGIN = 'https://elitea.example.test';

describe('toAbsoluteApiUrl', () => {
  /*
   * `docker-entrypoint.sh` writes `vite_server_url: "/api/v2"` whenever one
   * gateway fronts both the SPA and elitea-main, and that is the shipped
   * default. The Settings screen showed that bare path beside a copy button,
   * where it addresses nothing.
   */
  it('resolves a path against the origin', () => {
    expect(toAbsoluteApiUrl('/api/v2', ORIGIN)).toBe(`${ORIGIN}/api/v2`);
  });

  it('adds the missing separator for a path with no leading slash', () => {
    expect(toAbsoluteApiUrl('api/v2', ORIGIN)).toBe(`${ORIGIN}/api/v2`);
  });

  it('leaves an absolute URL alone, including a different host', () => {
    expect(toAbsoluteApiUrl('https://api.elsewhere.test/api/v2', ORIGIN)).toBe('https://api.elsewhere.test/api/v2');
  });

  it('leaves a protocol-relative URL alone', () => {
    expect(toAbsoluteApiUrl('//api.elsewhere.test/api/v2', ORIGIN)).toBe('//api.elsewhere.test/api/v2');
  });

  it('returns an empty value unchanged, so the caller can show its own "not configured" text', () => {
    expect(toAbsoluteApiUrl('', ORIGIN)).toBe('');
    expect(toAbsoluteApiUrl('   ', ORIGIN)).toBe('');
  });

  it('returns the path unchanged when no origin is known', () => {
    expect(toAbsoluteApiUrl('/api/v2', '')).toBe('/api/v2');
  });
});

describe('toOpenAiBaseUrl', () => {
  it('replaces the /api/v2 suffix with /llm/v1 and resolves the result', () => {
    expect(toOpenAiBaseUrl('/api/v2', ORIGIN)).toBe(`${ORIGIN}/llm/v1`);
    expect(toOpenAiBaseUrl('https://api.elsewhere.test/api/v2', ORIGIN)).toBe('https://api.elsewhere.test/llm/v1');
  });

  it('tolerates a trailing slash on the API URL', () => {
    expect(toOpenAiBaseUrl('/api/v2/', ORIGIN)).toBe(`${ORIGIN}/llm/v1`);
  });

  it('appends /llm/v1 when the API URL does not end in /api/v2', () => {
    expect(toOpenAiBaseUrl('https://api.elsewhere.test', ORIGIN)).toBe('https://api.elsewhere.test/llm/v1');
  });

  it('returns an empty value unchanged', () => {
    expect(toOpenAiBaseUrl('', ORIGIN)).toBe('');
  });
});
