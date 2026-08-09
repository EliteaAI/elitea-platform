import { describe, expect, it } from 'vitest';

import { normaliseArtifactList } from './normalise';
import type { ArtifactListWire } from '../model/types';

describe('normaliseArtifactList', () => {
  it('maps the object summaries and attaches the requested bucket to each', () => {
    const wire: ArtifactListWire = {
      common_prefixes: [],
      objects: [
        { key: 'a.txt', size_bytes: 10, media_type: 'text/plain', etag: 'e1', modified_at: '2026-01-01T00:00:00Z' },
        { key: 'b.txt', size_bytes: 20, media_type: 'text/plain', etag: 'e2', modified_at: '2026-01-02T00:00:00Z' },
      ],
    };
    expect(normaliseArtifactList(wire, 'my-bucket')).toEqual([
      { key: 'a.txt', size: 10, lastModified: '2026-01-01T00:00:00Z', bucket: 'my-bucket' },
      { key: 'b.txt', size: 20, lastModified: '2026-01-02T00:00:00Z', bucket: 'my-bucket' },
    ]);
  });

  it('returns an empty array for an empty object list', () => {
    expect(normaliseArtifactList({ objects: [], common_prefixes: [] }, 'empty-bucket')).toEqual([]);
  });
});
