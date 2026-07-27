import { describe, expect, it } from 'vitest';

import { filterArtifactsByQuery, formatArtifactSize, sortArtifactsByRecency } from './selectors';
import type { Artifact } from './types';

const artifact = (key: string, lastModified: string, size = 0): Artifact => ({ key, size, lastModified, bucket: 'b' });

describe('formatArtifactSize', () => {
  it('renders 0 bytes as "0 B"', () => {
    expect(formatArtifactSize(0)).toBe('0 B');
  });

  it('renders a negative size as "0 B"', () => {
    expect(formatArtifactSize(-5)).toBe('0 B');
  });

  it('renders whole bytes with 0 decimals', () => {
    expect(formatArtifactSize(512)).toBe('512 B');
  });

  it('renders exactly 1024 bytes as 1.0 KB', () => {
    expect(formatArtifactSize(1024)).toBe('1.0 KB');
  });

  it('renders megabytes with 1 decimal', () => {
    expect(formatArtifactSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('renders gigabytes', () => {
    expect(formatArtifactSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});

describe('sortArtifactsByRecency', () => {
  it('orders most-recently-modified first', () => {
    const older = artifact('old.txt', '2026-01-01T00:00:00Z');
    const newer = artifact('new.txt', '2026-01-05T00:00:00Z');
    expect(sortArtifactsByRecency([older, newer]).map((a) => a.key)).toEqual(['new.txt', 'old.txt']);
  });

  it('does not mutate the input', () => {
    const list = [artifact('a', '2026-01-01T00:00:00Z'), artifact('b', '2026-01-02T00:00:00Z')];
    const copy = [...list];
    sortArtifactsByRecency(list);
    expect(list).toEqual(copy);
  });
});

describe('filterArtifactsByQuery', () => {
  const artifacts = [artifact('readme.md', '2026-01-01T00:00:00Z'), artifact('data.json', '2026-01-01T00:00:00Z')];

  it('matches case-insensitive substrings', () => {
    expect(filterArtifactsByQuery(artifacts, 'READ').map((a) => a.key)).toEqual(['readme.md']);
  });

  it('returns every artifact for a blank query', () => {
    expect(filterArtifactsByQuery(artifacts, '')).toEqual(artifacts);
  });
});
