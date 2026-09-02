import { describe, expect, it } from 'vitest';

import { wikiPageObjectKey } from './pageKey';

describe('wikiPageObjectKey', () => {
  it('joins a relative manifest entry onto the wiki id (the fixture runner form)', () => {
    expect(wikiPageObjectKey('acme--svc--main', 'wiki_pages/overview/getting-started.md')).toBe(
      'acme--svc--main/wiki_pages/overview/getting-started.md',
    );
  });

  it('keeps an absolute entry as it is (the engine form) — no doubled prefix', () => {
    expect(wikiPageObjectKey('acme--svc--main', 'acme--svc--main/wiki_pages/README.md')).toBe(
      'acme--svc--main/wiki_pages/README.md',
    );
  });

  it('does not mistake a sibling wiki whose id merely starts the same for an absolute entry', () => {
    expect(wikiPageObjectKey('acme--svc--main', 'acme--svc--main-v2/wiki_pages/README.md')).toBe(
      'acme--svc--main/acme--svc--main-v2/wiki_pages/README.md',
    );
  });

  it('passes the entry through when there is no wiki id to join', () => {
    expect(wikiPageObjectKey('', 'wiki_pages/README.md')).toBe('wiki_pages/README.md');
  });
});
