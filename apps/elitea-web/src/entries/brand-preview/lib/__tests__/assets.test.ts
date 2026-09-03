/**
 * Dropped file name → pack field (ADR-0024 WP9).
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, type BrandPack } from '@/shared/brand';

import {
  ASSET_FILE_ACCEPT,
  assetTargetFor,
  basenameOf,
  describeTarget,
  displayUrlFor,
  fontUrlFor,
  targetId,
  type LoadedAsset,
} from '../assets';

const pack: BrandPack = {
  ...DEFAULT_BRAND_PACK,
  assets: {
    logoFull: 'brand/wordmark.svg',
    logoMark: './brand/logo-mark.svg',
    favicon: 'brand/icon.ico',
    loginArt: 'brand/login-art.png',
  },
  typography: {
    ...DEFAULT_BRAND_PACK.typography,
    fontFaces: [
      { family: 'Tenant Sans', url: './fonts/TenantSans-Regular.woff2', weight: '400' },
      { family: 'Tenant Sans', url: './fonts/TenantSans-Bold.woff2', weight: '700' },
    ],
  },
};

describe('assetTargetFor', () => {
  it('prefers the field whose path ends with the dropped file name', () => {
    expect(assetTargetFor(pack, 'wordmark.svg')).toEqual({ kind: 'asset', key: 'logoFull' });
    expect(assetTargetFor(pack, 'icon.ico')).toEqual({ kind: 'asset', key: 'favicon' });
  });

  it('matches the whole basename, not a suffix of it', () => {
    // `mark.svg` is a suffix of `logo-mark.svg` but not its basename.
    expect(assetTargetFor(pack, 'mark.svg')).toBeUndefined();
  });

  it('falls back to the conventional stems, whatever the extension', () => {
    expect(assetTargetFor(pack, 'logo-full.png')).toEqual({ kind: 'asset', key: 'logoFull' });
    expect(assetTargetFor(pack, 'logo-mark.webp')).toEqual({ kind: 'asset', key: 'logoMark' });
    expect(assetTargetFor(pack, 'favicon.svg')).toEqual({ kind: 'asset', key: 'favicon' });
    expect(assetTargetFor(pack, 'Login-Art.PNG')).toEqual({ kind: 'asset', key: 'loginArt' });
  });

  it('maps a woff2 to the face whose url ends with the file name', () => {
    expect(assetTargetFor(pack, 'TenantSans-Bold.woff2')).toEqual({ kind: 'font', fileName: 'TenantSans-Bold.woff2' });
  });

  it('refuses a font no face names, and a pack with no faces', () => {
    expect(assetTargetFor(pack, 'Other.woff2')).toBeUndefined();
    expect(assetTargetFor(DEFAULT_BRAND_PACK, 'TenantSans-Bold.woff2')).toBeUndefined();
  });

  it('refuses an extension the package does not carry', () => {
    expect(assetTargetFor(pack, 'logo-full.jpg')).toBeUndefined();
    expect(assetTargetFor(pack, 'brand-pack.json')).toBeUndefined();
    expect(assetTargetFor(pack, 'TenantSans.ttf')).toBeUndefined();
    expect(assetTargetFor(pack, 'README')).toBeUndefined();
  });

  it('accepts exactly the extensions the file input lists', () => {
    expect(ASSET_FILE_ACCEPT).toBe('.svg,.png,.webp,.ico,.woff2');
  });
});

describe('targetId / describeTarget', () => {
  it('keys an image by its slot and a font by its file name', () => {
    expect(targetId({ kind: 'asset', key: 'favicon' })).toBe('asset:favicon');
    expect(targetId({ kind: 'font', fileName: 'A.woff2' })).toBe('font:A.woff2');
  });

  it('names the pack field', () => {
    expect(describeTarget({ kind: 'asset', key: 'logoFull' })).toBe('assets.logoFull');
    expect(describeTarget({ kind: 'font', fileName: 'A.woff2' })).toContain('typography.fontFaces');
  });
});

describe('displayUrlFor / fontUrlFor', () => {
  const loaded: LoadedAsset = { fileName: 'logo-full.png', objectUrl: 'blob:null/logo', target: { kind: 'asset', key: 'logoFull' } };
  const font: LoadedAsset = { fileName: 'TenantSans-Bold.woff2', objectUrl: 'blob:null/bold', target: { kind: 'font', fileName: 'TenantSans-Bold.woff2' } };
  const assets = new Map([
    [targetId(loaded.target), loaded],
    [targetId(font.target), font],
  ]);

  it('shows the loaded file for its slot', () => {
    expect(displayUrlFor(pack, 'logoFull', assets)).toBe('blob:null/logo');
  });

  it('shows nothing for a package-relative path with no loaded file', () => {
    expect(displayUrlFor(pack, 'logoMark', assets)).toBeUndefined();
  });

  it('shows a data: URI the pack carries inline', () => {
    const inline = { ...pack, assets: { ...pack.assets, logoMark: 'data:image/svg+xml,%3Csvg%2F%3E' } };
    expect(displayUrlFor(inline, 'logoMark', assets)).toBe('data:image/svg+xml,%3Csvg%2F%3E');
  });

  it('resolves a face url by its file name, and leaves an unloaded face alone', () => {
    expect(fontUrlFor('./fonts/TenantSans-Bold.woff2', assets)).toBe('blob:null/bold');
    expect(fontUrlFor('./fonts/TenantSans-Regular.woff2', assets)).toBeUndefined();
  });
});

describe('basenameOf', () => {
  it('returns the last segment, or the whole string when there is no slash', () => {
    expect(basenameOf('./a/b/c.svg')).toBe('c.svg');
    expect(basenameOf('c.svg')).toBe('c.svg');
  });
});
