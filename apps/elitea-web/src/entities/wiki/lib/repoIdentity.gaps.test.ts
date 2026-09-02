/**
 * The behaviours the legacy oracle does NOT cover.
 *
 * HOW THESE WERE FOUND, and why the file exists. The 27 legacy cases in
 * repoIdentity.test.ts passed against this port on the first run, which is
 * exactly the result to distrust — a green suite is evidence about the suite as
 * much as about the code. Eight mutations were applied to the implementation
 * and four of them survived, meaning the legacy suite would have stayed green
 * through each:
 *
 *   1. manifestMatchesRepo drops its branch asymmetry
 *   2. artifactMatchesRepo drops its branch asymmetry
 *   3. normalizeWikiIdPart stops collapsing repeated hyphens
 *   4. parseRepositoryIdentity stops stripping a `.git` suffix
 *
 * The first two are not cosmetic. They decide whether a project configured for
 * one branch also sees another branch's wiki — and, through the leaf-matching
 * path, whether it can see a DIFFERENT REPOSITORY's wiki. Shipping the port
 * with only the legacy cases would have left the rule that prevents that
 * untested in both places it is written.
 *
 * Each test below names the mutation it kills.
 */
import { describe, expect, it } from 'vitest';

import { artifactMatchesRepo, manifestMatchesRepo } from './repoMatch';
import { parseRepositoryIdentity } from './repoUrl';
import { normalizeWikiIdPart } from './wikiId';

describe('the branch rule is asymmetric, on purpose', () => {
  // Kills: `return normalizedPrefix.startsWith(`${expectedPrefix}--`)` without
  // the `!expectedInfo.hasBranch` guard.
  it('a configuration WITH a branch does not match another branch of the same repository', () => {
    const otherBranch = { wiki_id: 'acme--notes-service--main--extra' };
    expect(manifestMatchesRepo(otherBranch, { repository: 'acme/notes-service', branch: 'main' }))
      .toBe(false);
  });

  it('a configuration WITHOUT a branch matches every branch of that repository', () => {
    // This half is what makes the rule asymmetric rather than simply strict:
    // an unbranched configuration is a request for all of them.
    const someBranch = { wiki_id: 'acme--notes-service--develop' };
    expect(manifestMatchesRepo(someBranch, 'acme/notes-service')).toBe(true);
  });

  it('a configuration WITH a branch still matches its own branch exactly', () => {
    const ownBranch = { wiki_id: 'acme--notes-service--main' };
    expect(manifestMatchesRepo(ownBranch, { repository: 'acme/notes-service', branch: 'main' }))
      .toBe(true);
  });

  // Kills: the same guard removed from artifactMatchesRepo. The rule is written
  // in two places and the legacy suite covered neither.
  it('an artifact key follows the same asymmetry', () => {
    const branched = { repository: 'acme/notes-service', branch: 'main' };
    expect(artifactMatchesRepo('acme--notes-service--main--extra/page.md', branched)).toBe(false);
    expect(artifactMatchesRepo('acme--notes-service--main/page.md', branched)).toBe(true);
    // Unbranched: the suffix match is allowed.
    expect(artifactMatchesRepo('acme--notes-service--main/page.md', 'acme/notes-service'))
      .toBe(true);
  });
});

describe('wiki_id part normalisation', () => {
  // Kills: removing `.replace(/-+/g, '-')`. Without it, a repository named
  // "notes service" normalises to "notes-service" but "notes  service"
  // normalises to "notes--service" — which contains the wiki_id SEPARATOR and
  // splits into two components, so the prefix no longer matches the stored one.
  it('collapses runs of separators into a single hyphen', () => {
    expect(normalizeWikiIdPart('notes  service')).toBe('notes-service');
    expect(normalizeWikiIdPart('a__b..c')).toBe('a-b-c');
  });

  it('trims leading and trailing separators, and empties to null', () => {
    expect(normalizeWikiIdPart('_leading')).toBe('leading');
    expect(normalizeWikiIdPart('trailing_')).toBe('trailing');
    // null rather than '', so a caller cannot join it and produce `a----b`.
    expect(normalizeWikiIdPart('___')).toBeNull();
    expect(normalizeWikiIdPart('')).toBeNull();
  });
});

describe('repository reference parsing', () => {
  // Kills: dropping `.replace(/\.git$/, '')`. A clone URL and a plain path are
  // the same repository, and a wiki generated from one must be found from the
  // other.
  it('strips a .git suffix so a clone URL and a plain path agree', () => {
    expect(parseRepositoryIdentity('https://github.com/acme/notes-service.git').repository)
      .toBe('acme/notes-service');
    expect(parseRepositoryIdentity('git@github.com:acme/notes-service.git').repository)
      .toBe('acme/notes-service');
    expect(parseRepositoryIdentity('acme/notes-service').repository)
      .toBe('acme/notes-service');
  });

  it('a malformed URL yields no identity rather than a partial one', () => {
    expect(parseRepositoryIdentity('https://')).toEqual({ repository: null, branch: null });
  });
});
