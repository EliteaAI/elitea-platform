import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENTITY_TAB,
  PROJECT_ID_URL_PREFIX,
  clearBaseUrlPrefix,
  replacePathParams,
  replaceVersionInPath,
} from './url';

describe('clearBaseUrlPrefix', () => {
  it.each([
    ['https://api.example.com/v2/', undefined, 'https://api.example.com/v2'],
    ['https://api.example.com/v2///', undefined, 'https://api.example.com/v2'],
  ])('clearBaseUrlPrefix(%j, %j) -> %j', (url, suffix, expected) => {
    expect(clearBaseUrlPrefix(url, suffix)).toBe(expected);
  });

  it('strips a trailing suffix segment when the url ends with a slash', () => {
    expect(clearBaseUrlPrefix('https://api.example.com/v2/', 'v2')).toBe('https://api.example.com');
  });

  it('strips a trailing suffix segment when the url does not end with a slash', () => {
    expect(clearBaseUrlPrefix('https://api.example.com/v2', 'v2')).toBe('https://api.example.com');
  });

  it('always strips trailing slashes even with no suffix', () => {
    expect(clearBaseUrlPrefix('https://api.example.com///')).toBe('https://api.example.com');
  });

  it(
    'preserved quirk (N4): `suffix` is removed via String.replace(substring), ' +
      'which strips the FIRST occurrence anywhere in the url — not necessarily ' +
      'the trailing one — if the suffix text coincidentally also appears earlier',
    () => {
      // '/api' happens to also match inside "https://api..." (the "//a" +
      // "pi" boundary reads as "/api" starting one character in), so it is
      // stripped from THERE instead of from the trailing "/v2/api" the
      // caller actually meant to remove.
      expect(clearBaseUrlPrefix('https://api.example.com/v2/api', '/api')).toBe(
        'https:/.example.com/v2/api',
      );
    },
  );
});

describe('replacePathParams', () => {
  it('replaces :key tokens with the corresponding param value', () => {
    expect(replacePathParams('/projects/:projectId/agents/:agentId', { projectId: '1', agentId: '2' })).toBe(
      '/projects/1/agents/2',
    );
  });

  it('coerces numeric param values to strings', () => {
    expect(replacePathParams('/items/:id', { id: 42 })).toBe('/items/42');
  });

  it('leaves unmatched :key tokens untouched', () => {
    expect(replacePathParams('/a/:missing', { other: '1' })).toBe('/a/:missing');
  });

  it(
    'preserved quirk (N4): String.replace with a string pattern only replaces the ' +
      'FIRST occurrence — a repeated :key token is not fully substituted',
    () => {
      expect(replacePathParams('/:id/nested/:id', { id: 'X' })).toBe('/X/nested/:id');
    },
  );
});

describe('replaceVersionInPath', () => {
  it('replaces the id/currentVersion segment with id/newVersion', () => {
    expect(replaceVersionInPath('v2', '/agents/123/v1/detail', 'v1', '123')).toBe('/agents/123/v2/detail');
  });

  it('URL-encodes the new version name', () => {
    expect(replaceVersionInPath('v 2', '/agents/123/v1', 'v1', '123')).toBe('/agents/123/v%202');
  });

  it('appends the new version when the current-version segment is absent and a name is given', () => {
    expect(replaceVersionInPath('v2', '/agents/123', '', '123')).toBe('/agents/123/v2');
  });

  it('returns pathname unchanged when neither the segment nor a new name is present', () => {
    expect(replaceVersionInPath('', '/agents/123', '', '123')).toBe('/agents/123');
  });

  it('returns pathname unchanged when currentVersion is set but the segment is not found', () => {
    expect(replaceVersionInPath('v2', '/agents/999/v1', 'v1', '123')).toBe('/agents/999/v1/v2');
  });
});

describe('DEFAULT_ENTITY_TAB / PROJECT_ID_URL_PREFIX', () => {
  it('preserves the exact old-app values (utils.jsx:1045-1046)', () => {
    expect(DEFAULT_ENTITY_TAB).toBe('all');
    expect(PROJECT_ID_URL_PREFIX).toBe('/:projectId');
  });

  it('composes with replacePathParams the same way usePageDetails.js does', () => {
    const path = replacePathParams(`${PROJECT_ID_URL_PREFIX}/agents/:tab/:agentId`, {
      projectId: '42',
      tab: DEFAULT_ENTITY_TAB,
      agentId: 'a1',
    });
    expect(path).toBe('/42/agents/all/a1');
  });
});
