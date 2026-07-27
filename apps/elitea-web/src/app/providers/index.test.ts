import { describe, expect, it } from 'vitest';

import * as providers from './index';

/**
 * Pins the barrel's exported surface (same convention as
 * `src/shared/brand/index.test.ts` / `src/shared/i18n/index.test.ts`): a
 * rename or an accidental removal fails a test here instead of surfacing as
 * a downstream mystery in App.tsx or a future R1 patch.
 */
const PUBLIC_SURFACE = [
  'AppErrorBoundary',
  'AppProviders',
  'BrandThemeProvider',
  'QUERY_DEFAULT_OPTIONS',
  'createAppQueryClient',
  'getAppBasename',
] as const;

describe('app/providers public surface', () => {
  it('exports exactly the documented set', () => {
    expect(Object.keys(providers).sort()).toEqual([...PUBLIC_SURFACE].sort());
  });

  it('AppProviders is a usable component', () => {
    expect(typeof providers.AppProviders).toBe('function');
  });

  it('AppErrorBoundary is a usable component', () => {
    expect(typeof providers.AppErrorBoundary).toBe('function');
  });

  it('BrandThemeProvider is a usable component', () => {
    expect(typeof providers.BrandThemeProvider).toBe('function');
  });

  it('createAppQueryClient and getAppBasename are usable functions', () => {
    expect(typeof providers.createAppQueryClient).toBe('function');
    expect(typeof providers.getAppBasename).toBe('function');
  });
});
