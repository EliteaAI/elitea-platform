/**
 * The live preview's scope root (ADR-0024 WP9 fix).
 *
 * `PREVIEW_THEME_SCOPE.rootSelector` is the selector MUI emits the
 * scheme-independent variables under — spacing and the `--elp-shape-*` radii.
 * WP4 never applied that class, so every radius inside the preview resolved to
 * nothing. This pins the container to the selector's class, and pins the
 * selector to the class, so neither can drift from the other.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

import {
  DEFAULT_BRAND_PACK,
  DEFAULT_COLOR_SCHEME,
  PREVIEW_ROOT_CLASS,
  PREVIEW_THEME_SCOPE,
  buildEliteaTheme,
} from '@/shared/brand';

import { BrandingPreview } from './BrandingPreview';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

describe('BrandingPreview', () => {
  it('carries the scope root class on the common ancestor of both scheme surfaces', () => {
    render(
      <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
        <BrandingPreview pack={DEFAULT_BRAND_PACK} />
      </ThemeProvider>,
    );
    const root = screen.getByTestId('branding-preview');
    expect(root).toHaveClass(PREVIEW_ROOT_CLASS);
    expect(PREVIEW_THEME_SCOPE.rootSelector).toBe(`.${PREVIEW_ROOT_CLASS}`);
    // Both surfaces are inside it, so the variables the selector scopes reach them.
    expect(root.contains(screen.getByTestId('branding-preview-light'))).toBe(true);
    expect(root.contains(screen.getByTestId('branding-preview-dark'))).toBe(true);
    // The root itself matches the selector the theme emits its variables under.
    expect(root.matches(PREVIEW_THEME_SCOPE.rootSelector)).toBe(true);
  });
});
