import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BRAND_PACK_GLOBAL, DEFAULT_BRAND_PACK } from '@/shared/brand';

import { BrandLogoFull, BrandLogoMark } from './BrandLogo';

const globalWindow = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete globalWindow[BRAND_PACK_GLOBAL];
});

describe('BrandLogo (ADR-0024 WP3)', () => {
  it('renders the compiled SVG components when no pack was served', () => {
    const { getByTestId } = render(
      <>
        <BrandLogoMark style={{ width: '2rem', height: '2rem' }} />
        <BrandLogoFull />
      </>,
    );
    expect(getByTestId('brand-logo-mark').tagName).toBe('svg');
    expect(getByTestId('brand-logo-full').tagName).toBe('svg');
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders the compiled SVG when the served pack restates the default asset paths', () => {
    globalWindow[BRAND_PACK_GLOBAL] = { ...DEFAULT_BRAND_PACK, id: 'restated' };
    const { getByTestId } = render(<BrandLogoMark />);
    expect(getByTestId('brand-logo-mark').tagName).toBe('svg');
  });

  it('renders <img src alt=product.name> for a served custom asset, sized by the same style', () => {
    globalWindow[BRAND_PACK_GLOBAL] = {
      ...DEFAULT_BRAND_PACK,
      id: 'tenant',
      product: { name: 'Contoso Cloud', shortName: 'Contoso' },
      assets: { ...DEFAULT_BRAND_PACK.assets, logoFull: '/app/brand/contoso-full.svg' },
    };
    const { getByTestId } = render(
      <>
        <BrandLogoFull style={{ width: '6rem' }} />
        <BrandLogoMark />
      </>,
    );
    const full = getByTestId('brand-logo-full');
    expect(full.tagName).toBe('IMG');
    expect(full.getAttribute('src')).toBe('/app/brand/contoso-full.svg');
    expect(full.getAttribute('alt')).toBe('Contoso Cloud');
    expect(full.style.width).toBe('6rem');
    // Only the slot the pack customised swaps; the mark stays compiled.
    expect(getByTestId('brand-logo-mark').tagName).toBe('svg');
  });

  it('keeps the compiled SVG when the served pack is invalid (degraded to the default pack)', () => {
    globalWindow[BRAND_PACK_GLOBAL] = { id: 'broken', assets: { logoMark: '/x.svg' } };
    const { getByTestId } = render(<BrandLogoMark />);
    expect(getByTestId('brand-logo-mark').tagName).toBe('svg');
  });
});
