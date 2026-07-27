import { describe, expect, it } from 'vitest';

import type { Version } from './types';

describe('Version.author', () => {
  /**
   * v2.yaml:611-660 `ApplicationVersionDetail` declares `author_id` and
   * `author: {$ref: Author}` as SIBLING optional properties (NOTE(W2),
   * v2.yaml:643-656): CreateVersion's response populates `author` (+
   * `is_forked`) but NOT `author_id` (applications/handler.go:783-801).
   * This test constructs exactly that CreateVersion-shaped object — this is
   * a type-level contract: if `Version.author` were removed, this file
   * would fail `tsc --noEmit` (excess-property error on the object
   * literal) even though the plain JS the object literal produces is
   * unaffected — TypeScript's structural check is the only mechanism that
   * can catch a missing OPTIONAL field in a type, since JS itself does not
   * enforce interface shapes at runtime.
   */
  it('accepts the CreateVersion response shape (author populated, authorId absent)', () => {
    const version: Version = {
      id: '42',
      applicationId: '7',
      name: 'v2',
      status: 'draft',
      isForked: false,
      author: { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace' },
    };
    expect(version.author?.name).toBe('Ada Lovelace');
    expect(version.authorId).toBeUndefined();
  });
});
