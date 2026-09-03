/**
 * Export (ADR-0024 WP9): the current pack as the `brand-pack.json` a
 * branding package ships. Loaded assets never enter the pack — they are
 * object URLs in a separate map — so the file states package-relative
 * paths, which is what the Go importer reads.
 */
import type { BrandPack } from '@/shared/brand';

export const BRAND_PACK_FILE_NAME = 'brand-pack.json';

/** Two-space indent and a trailing newline, as `default.pack.json` is committed. */
export function serialiseBrandPack(pack: BrandPack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}
