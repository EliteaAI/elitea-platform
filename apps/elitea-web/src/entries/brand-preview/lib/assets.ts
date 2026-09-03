/**
 * Dropped files → pack fields (ADR-0024 WP9).
 *
 * A designer drops `logo-full.png` next to a pack that says
 * `assets.logoFull: "./brand/logo-full.svg"`. The file must land on that
 * slot, and nothing is ever written to disk: the file is held as an object
 * URL in memory and the pack keeps its own path, so an export still states
 * the package-relative path the Go importer expects.
 *
 * Two rules, in order:
 *
 *  1. the pack field whose path ENDS with the dropped file name wins
 *     (`assets.favicon: "brand/icon.ico"` takes a dropped `icon.ico`);
 *  2. else the file's stem picks the slot by convention
 *     (`logo-full.*` → `assets.logoFull`, `logo-mark.*` → `assets.logoMark`,
 *     `favicon.*` → `assets.favicon`, `login-art.*` → `assets.loginArt`).
 *
 * A `.woff2` file has one rule only: it feeds the `typography.fontFaces[]`
 * entry whose `url` ends with the file name. A face the pack does not name
 * has nothing to attach to, and the drop is reported rather than guessed.
 *
 * Loaded assets are keyed by their TARGET, not by file name, so a logo stays
 * on its slot when the designer reloads a pack that spells the path
 * differently. A font is keyed by the file name its face names, and
 * re-resolves against whichever pack is active.
 */
import type { BrandAssetKey, BrandPack } from '@/shared/brand';

const IMAGE_EXTENSIONS: readonly string[] = ['svg', 'png', 'webp', 'ico'];
const FONT_EXTENSIONS: readonly string[] = ['woff2'];

/** The `accept` attribute of the "Add assets" file input. */
export const ASSET_FILE_ACCEPT = [...IMAGE_EXTENSIONS, ...FONT_EXTENSIONS].map((ext) => `.${ext}`).join(',');

/** The extension list a refusal message names. */
export const ACCEPTED_ASSET_EXTENSIONS = [...IMAGE_EXTENSIONS, ...FONT_EXTENSIONS].join(', ');

export type AssetTarget =
  | { readonly kind: 'asset'; readonly key: BrandAssetKey }
  | { readonly kind: 'font'; readonly fileName: string };

const ASSET_KEYS: readonly BrandAssetKey[] = ['logoFull', 'logoMark', 'favicon', 'loginArt'];

const STEM_TO_KEY: Readonly<Record<string, BrandAssetKey | undefined>> = {
  'logo-full': 'logoFull',
  'logo-mark': 'logoMark',
  favicon: 'favicon',
  'login-art': 'loginArt',
};

/** The last path segment; a bare name is its own basename. */
export function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot === -1 ? fileName : fileName.slice(0, dot)).toLowerCase();
}

type PackShape = Pick<BrandPack, 'assets' | 'typography'>;

function imageTargetFor(assets: PackShape['assets'], fileName: string): AssetTarget | undefined {
  const byPath = ASSET_KEYS.find((key) => {
    const value = assets[key];
    return value !== undefined && basenameOf(value) === fileName;
  });
  if (byPath !== undefined) return { kind: 'asset', key: byPath };
  const byStem = STEM_TO_KEY[stemOf(fileName)];
  return byStem === undefined ? undefined : { kind: 'asset', key: byStem };
}

function fontTargetFor(pack: PackShape, fileName: string): AssetTarget | undefined {
  const faces = pack.typography.fontFaces ?? [];
  return faces.some((face) => basenameOf(face.url) === fileName) ? { kind: 'font', fileName } : undefined;
}

/** The pack field a dropped file feeds, or `undefined` when none does. */
export function assetTargetFor(pack: PackShape, fileName: string): AssetTarget | undefined {
  const extension = extensionOf(fileName);
  if (IMAGE_EXTENSIONS.includes(extension)) return imageTargetFor(pack.assets, fileName);
  if (FONT_EXTENSIONS.includes(extension)) return fontTargetFor(pack, fileName);
  return undefined;
}

/** The map key of a target — one slot holds one file. */
export function targetId(target: AssetTarget): string {
  return target.kind === 'asset' ? `asset:${target.key}` : `font:${target.fileName}`;
}

/** The pack field a target stands for, as the page names it. */
export function describeTarget(target: AssetTarget): string {
  return target.kind === 'asset' ? `assets.${target.key}` : `typography.fontFaces[url = …/${target.fileName}]`;
}

export interface LoadedAsset {
  readonly fileName: string;
  /** `URL.createObjectURL(file)`; revoked when the slot is replaced. */
  readonly objectUrl: string;
  readonly target: AssetTarget;
}

/** Keyed by `targetId(asset.target)`. */
export type LoadedAssets = ReadonlyMap<string, LoadedAsset>;

/**
 * What an `<img>` can show for one asset slot: the loaded file, else a
 * `data:` URI the pack carries inline. A package-relative path resolves to
 * nothing from disk, so it yields `undefined` and the surface falls back to
 * the product name.
 */
export function displayUrlFor(pack: Pick<BrandPack, 'assets'>, key: BrandAssetKey, assets: LoadedAssets): string | undefined {
  const loaded = assets.get(targetId({ kind: 'asset', key }));
  if (loaded !== undefined) return loaded.objectUrl;
  const value = pack.assets[key];
  return value !== undefined && value.startsWith('data:') ? value : undefined;
}

/** The object URL loaded for a face's `url`, matched by file name. */
export function fontUrlFor(url: string, assets: LoadedAssets): string | undefined {
  return assets.get(targetId({ kind: 'font', fileName: basenameOf(url) }))?.objectUrl;
}
