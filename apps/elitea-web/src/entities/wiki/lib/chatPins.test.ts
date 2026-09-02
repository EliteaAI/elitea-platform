import { describe, expect, it } from 'vitest';

import { chatPinsFor } from './chatPins';

describe('chatPinsFor', () => {
  it("pins the engine manifest's commit-scoped identifier and its analysis key", () => {
    expect(
      chatPinsFor({
        canonical_repo_identifier: 'acme/e2e-generated:main:4d242ae8',
        analysis_key: 'acme/e2e-generated:main:4d242ae8@20260902T134600Z-f43ace1d',
      }),
    ).toEqual({
      repoIdentifierOverride: 'acme/e2e-generated:main:4d242ae8',
      analysisKeyOverride: 'acme/e2e-generated:main:4d242ae8@20260902T134600Z-f43ace1d',
    });
  });

  it('pins a branch-qualified identifier without a commit, and no analysis key', () => {
    expect(chatPinsFor({ canonical_repo_identifier: 'acme/app:main' })).toEqual({
      repoIdentifierOverride: 'acme/app:main',
    });
  });

  it('pins NOTHING for a bare repository name — the fixture manifest form — so the engine resolves it', () => {
    expect(chatPinsFor({ canonical_repo_identifier: 'acme/e2e-generated', repository: 'acme/e2e-generated' })).toEqual(
      {},
    );
  });

  it('drops an analysis key that does not belong to the pinned identifier', () => {
    expect(
      chatPinsFor({ canonical_repo_identifier: 'acme/app:main:abc12345', analysis_key: 'acme/other:main:ffff0000@v1' }),
    ).toEqual({ repoIdentifierOverride: 'acme/app:main:abc12345' });
  });

  it('pins nothing without a manifest', () => {
    expect(chatPinsFor(undefined)).toEqual({});
  });
});
