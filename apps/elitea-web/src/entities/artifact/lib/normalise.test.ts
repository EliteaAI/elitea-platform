import { describe, expect, it } from 'vitest';

import { normaliseArtifactList } from './normalise';
import type { ArtifactListWire } from '../model/types';

describe('normaliseArtifactList', () => {
  it('flattens the envelope bucket name onto each entry', () => {
    const wire: ArtifactListWire = {
      name: 'my-bucket',
      contents: [
        { key: 'a.txt', size: 10, lastModified: '2026-01-01T00:00:00Z' },
        { key: 'b.txt', size: 20, lastModified: '2026-01-02T00:00:00Z' },
      ],
    };
    expect(normaliseArtifactList(wire)).toEqual([
      { key: 'a.txt', size: 10, lastModified: '2026-01-01T00:00:00Z', bucket: 'my-bucket' },
      { key: 'b.txt', size: 20, lastModified: '2026-01-02T00:00:00Z', bucket: 'my-bucket' },
    ]);
  });

  it('returns an empty array for an empty contents list', () => {
    expect(normaliseArtifactList({ name: 'empty-bucket', contents: [] })).toEqual([]);
  });
});
