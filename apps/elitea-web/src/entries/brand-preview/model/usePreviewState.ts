/**
 * The previewer's whole state (ADR-0024 WP9): the active pack, where it
 * came from, the files held in memory, and the last few things the page
 * told the designer. Nothing here touches storage or the network — a file
 * comes in through an `<input type="file">` or a drop, is read with the
 * File API, and is held as an object URL until it is replaced.
 */
import { useState } from 'react';

import type { BrandPack } from '@/shared/brand';
import { t } from '@/shared/i18n';

import {
  ACCEPTED_ASSET_EXTENSIONS,
  assetTargetFor,
  describeTarget,
  targetId,
  type LoadedAsset,
  type LoadedAssets,
} from '../lib/assets';
import { parseBrandPackText, type BootstrapResult, type PackSource } from '../lib/bootstrap';

export interface PreviewState {
  readonly pack: BrandPack;
  /** `pack` as it was loaded, before any edit; the hue edit derives against it. */
  readonly basePack: BrandPack;
  readonly source: PackSource | 'file';
  /** What the source is called on screen: the file name, or a label for the two built-in sources. */
  readonly sourceLabel: string;
  /** Why the last pack load was refused; empty after a successful load. */
  readonly issues: readonly string[];
  readonly assets: LoadedAssets;
  /** The most recent messages, newest first. */
  readonly notices: readonly string[];
}

export interface PreviewActions {
  readonly loadPackFile: (file: File) => Promise<void>;
  readonly addAssetFiles: (files: Iterable<File>) => void;
  /** Routes a drop: `.json` is a pack, anything else is an asset. */
  readonly dropFiles: (files: Iterable<File>) => Promise<void>;
  readonly updatePack: (update: (pack: BrandPack) => BrandPack) => void;
}

const MAX_NOTICES = 8;

function sourceLabelFor(source: PackSource): string {
  return source === 'inline'
    ? t('entries.brandPreview.source.inline', 'pack shipped inside this document')
    : t('entries.brandPreview.source.default', 'compiled default pack');
}

function initialState(bootstrap: BootstrapResult): PreviewState {
  const notices =
    bootstrap.issues.length === 0
      ? []
      : [t('entries.brandPreview.notice.inlineRefused', 'The pack shipped inside this document was refused; showing the compiled default.')];
  return {
    pack: bootstrap.pack,
    basePack: bootstrap.pack,
    source: bootstrap.source,
    sourceLabel: sourceLabelFor(bootstrap.source),
    issues: bootstrap.issues,
    assets: new Map(),
    notices,
  };
}

function withNotice(state: PreviewState, notice: string): PreviewState {
  return { ...state, notices: [notice, ...state.notices].slice(0, MAX_NOTICES) };
}

function attachAsset(state: PreviewState, file: File): PreviewState {
  const target = assetTargetFor(state.pack, file.name);
  if (target === undefined) {
    return withNotice(
      state,
      t('entries.brandPreview.notice.assetUnmapped', '{{file}}: no pack field takes this file (accepted: {{extensions}})', {
        file: file.name,
        extensions: ACCEPTED_ASSET_EXTENSIONS,
      }),
    );
  }
  const id = targetId(target);
  const previous = state.assets.get(id);
  if (previous !== undefined) URL.revokeObjectURL(previous.objectUrl);
  const loaded: LoadedAsset = { fileName: file.name, objectUrl: URL.createObjectURL(file), target };
  const assets = new Map(state.assets);
  assets.set(id, loaded);
  return withNotice(
    { ...state, assets },
    t('entries.brandPreview.notice.assetMapped', '{{file}} → {{target}}', { file: file.name, target: describeTarget(target) }),
  );
}

function isPackFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';
}

export function usePreviewState(bootstrap: BootstrapResult): readonly [PreviewState, PreviewActions] {
  const [state, setState] = useState<PreviewState>(() => initialState(bootstrap));

  const applyPackText = (fileName: string, text: string): void => {
    const result = parseBrandPackText(text);
    setState((current) => {
      if (!result.ok) {
        return withNotice(
          { ...current, issues: result.issues },
          t('entries.brandPreview.notice.packRefused', '{{file}} was refused; the previous pack stays active', { file: fileName }),
        );
      }
      return withNotice(
        { ...current, pack: result.pack, basePack: result.pack, source: 'file', sourceLabel: fileName, issues: [] },
        t('entries.brandPreview.notice.packLoaded', '{{file}} loaded', { file: fileName }),
      );
    });
  };

  const loadPackFile = async (file: File): Promise<void> => {
    applyPackText(file.name, await file.text());
  };

  const addAssetFiles = (files: Iterable<File>): void => {
    setState((current) => {
      let next = current;
      for (const file of files) next = attachAsset(next, file);
      return next;
    });
  };

  const dropFiles = async (files: Iterable<File>): Promise<void> => {
    const packs: File[] = [];
    const others: File[] = [];
    for (const file of files) (isPackFile(file) ? packs : others).push(file);
    for (const pack of packs) await loadPackFile(pack);
    addAssetFiles(others);
  };

  const updatePack = (update: (pack: BrandPack) => BrandPack): void => {
    setState((current) => ({ ...current, pack: update(current.pack) }));
  };

  return [state, { loadPackFile, addAssetFiles, dropFiles, updatePack }];
}
