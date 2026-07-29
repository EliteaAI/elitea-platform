import { describe, expect, it } from 'vitest';

import type { Artifact } from '@/entities/artifact';

import {
  buildFileTree,
  expandFoldersToArtifactKeys,
  getExpandedPathsFromFileKey,
  getItemsAtCurrentLevel,
  getItemsUnderFolder,
  parsePrefixToBreadcrumbs,
} from './fileTree';

const artifacts: Artifact[] = [
  { key: 'root.txt', size: 1, lastModified: '2026-01-01T00:00:00Z', bucket: 'docs' },
  { key: 'a/deep.txt', size: 2, lastModified: '2026-01-02T00:00:00Z', bucket: 'docs' },
  { key: 'a/other.txt', size: 3, lastModified: '2026-01-03T00:00:00Z', bucket: 'docs' },
  { key: 'b/nested/end.txt', size: 4, lastModified: '2026-01-04T00:00:00Z', bucket: 'docs' },
];

describe('artifact file tree', () => {
  it('lists folders before files at each level', () => {
    expect(getItemsAtCurrentLevel(artifacts).map(({ name, kind }) => [name, kind])).toEqual([
      ['a', 'folder'],
      ['b', 'folder'],
      ['root.txt', 'file'],
    ]);
    expect(getItemsAtCurrentLevel(artifacts, 'a/').map((item) => item.key)).toEqual([
      'a/deep.txt',
      'a/other.txt',
    ]);
  });

  it('builds breadcrumbs, expanded paths, and nested trees', () => {
    expect(parsePrefixToBreadcrumbs('b/nested/')).toEqual([
      { name: 'b', path: 'b/' },
      { name: 'nested', path: 'b/nested/' },
    ]);
    expect(getExpandedPathsFromFileKey('b/nested/end.txt')).toEqual(['b/', 'b/nested/']);
    expect(getExpandedPathsFromFileKey('b/nested/')).toEqual(['b/', 'b/nested/']);
    expect(getExpandedPathsFromFileKey('')).toEqual([]);
    expect(buildFileTree(artifacts)[1]?.children?.[0]?.name).toBe('nested');
  });

  it('expands selected folders and removes duplicate keys', () => {
    const folder = getItemsAtCurrentLevel(artifacts)[0];
    const file = getItemsAtCurrentLevel(artifacts).at(-1);
    expect(folder).toBeDefined();
    expect(file).toBeDefined();
    expect(getItemsUnderFolder(artifacts, 'a/')).toEqual(['a/deep.txt', 'a/other.txt']);
    expect(expandFoldersToArtifactKeys([folder!, file!, file!], artifacts)).toEqual([
      'a/deep.txt',
      'a/other.txt',
      'root.txt',
    ]);
    expect(getItemsUnderFolder([], 'a/')).toEqual([]);
  });
});
