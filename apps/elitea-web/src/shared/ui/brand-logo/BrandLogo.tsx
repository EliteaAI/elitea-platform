import { type CSSProperties, useMemo } from 'react';

import { resolveBrandAsset, resolveBrandPack } from '@/shared/brand';
import { LogoIcon } from '@/shared/ui/icons/logo-icon';
import { LogoMarkIcon } from '@/shared/ui/icons/logo-mark-icon';

export interface BrandLogoProps {
  /** Sizing only — the call sites pass `width`/`height`; both renderings honour it. */
  readonly style?: CSSProperties;
  readonly className?: string;
}

/**
 * The brand logo, pack-driven (ADR-0024 WP3).
 *
 * Renders `<img src={pack.assets.logoMark|logoFull}>` when the SERVED pack
 * states a custom asset (`shared/brand/assets.ts` — served AND different from
 * the compiled default), and the compiled-in SVG component otherwise. The
 * compiled components ARE the artwork the default pack's `./brand/*.svg`
 * placeholders stand in for, so a deployment with no served pack renders
 * byte-identically to before this module existed (JRNY-030's "the default
 * pack reproduces the baseline appearance").
 *
 * `alt` is the pack's `product.name`: the image is the product's own logo, so
 * its accessible name is the product. Where the logo sits inside a button
 * that already has an `aria-label` (the sidebar toggle), that label wins for
 * the control and the alt still names the image itself.
 *
 * Resolution is memoised once per mount: the pack is fixed for the document
 * (the global is written by a blocking script before the bundle runs), and
 * `resolveBrandPack()` runs a zod parse.
 */
function useBrandLogo(key: 'logoMark' | 'logoFull') {
  return useMemo(() => {
    const pack = resolveBrandPack();
    return { asset: resolveBrandAsset(key, pack), alt: pack.product.name };
  }, [key]);
}

/** The square MARK (the orb). */
export function BrandLogoMark({ style, className }: BrandLogoProps) {
  const { asset, alt } = useBrandLogo('logoMark');
  if (asset.custom && asset.url !== undefined) {
    return (
      <img
        src={asset.url}
        alt={alt}
        className={className}
        style={{ objectFit: 'contain', ...style }}
        data-testid="brand-logo-mark"
      />
    );
  }
  return <LogoMarkIcon style={style} className={className} data-testid="brand-logo-mark" />;
}

/** The full WORDMARK (orb + lettering). */
export function BrandLogoFull({ style, className }: BrandLogoProps) {
  const { asset, alt } = useBrandLogo('logoFull');
  if (asset.custom && asset.url !== undefined) {
    return (
      <img
        src={asset.url}
        alt={alt}
        className={className}
        style={{ objectFit: 'contain', ...style }}
        data-testid="brand-logo-full"
      />
    );
  }
  return <LogoIcon style={style} className={className} data-testid="brand-logo-full" />;
}
