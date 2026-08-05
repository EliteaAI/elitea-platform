import type { Artifact } from '@/entities/artifact';

import type { ArtifactBreadcrumb, ArtifactListItem, ArtifactTreeItem } from '../model/types';

export function getItemsAtCurrentLevel(contents: readonly Artifact[], prefix = ''): ArtifactListItem[] {
  const items: ArtifactListItem[] = [];
  const folders = new Set<string>();
  for (const artifact of contents) {
    if (!artifact.key.startsWith(prefix)) continue;
    const remainder = artifact.key.slice(prefix.length);
    const parts = remainder.split('/').filter(Boolean);
    const name = parts[0];
    if (name === undefined) continue;
    if (parts.length === 1) {
      items.push({
        id: artifact.key,
        key: artifact.key,
        name,
        kind: 'file',
        size: artifact.size,
        lastModified: artifact.lastModified,
      });
    } else if (!folders.has(name)) {
      folders.add(name);
      const key = `${prefix}${name}/`;
      items.push({ id: key, key, name, kind: 'folder', size: 0 });
    }
  }
  return items.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export function parsePrefixToBreadcrumbs(prefix: string): ArtifactBreadcrumb[] {
  const parts = prefix.split('/').filter(Boolean);
  return parts.map((name, index) => ({
    name,
    path: `${parts.slice(0, index + 1).join('/')}/`,
  }));
}

export function getItemsUnderFolder(contents: readonly Artifact[], folderKey: string): string[] {
  return contents.filter((artifact) => artifact.key.startsWith(folderKey) && artifact.key !== folderKey).map((artifact) => artifact.key);
}

export function expandFoldersToArtifactKeys(
  selectedItems: readonly ArtifactListItem[],
  contents: readonly Artifact[],
): string[] {
  return [...new Set(selectedItems.flatMap((item) => (item.kind === 'folder' ? getItemsUnderFolder(contents, item.key) : [item.key])))];
}

export function getExpandedPathsFromFileKey(key: string): string[] {
  if (key === '') return [];
  const parts = key.split('/').filter(Boolean);
  const limit = key.endsWith('/') ? parts.length : Math.max(0, parts.length - 1);
  return Array.from({ length: limit }, (_, index) => `${parts.slice(0, index + 1).join('/')}/`);
}

export function buildFileTree(contents: readonly Artifact[]): ArtifactTreeItem[] {
  const build = (prefix: string): ArtifactTreeItem[] =>
    getItemsAtCurrentLevel(contents, prefix).map((item) =>
      item.kind === 'folder' ? { ...item, children: build(item.key) } : item,
    );
  return build('');
}
