import { render, screen } from '@testing-library/react';
import { useTheme } from '@mui/material/styles';
import { useQueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK } from '@/shared/brand';
import { i18n, t } from '@/shared/i18n';
import type { TFunction } from '@/shared/i18n';

import { installWebStorageShim } from '../../test/webstorage';

import { AppProviders } from './AppProviders';

installWebStorageShim();

/**
 * Stand-in for a real feature component reading the theme + query-client
 * context this tree provides. Not "renders without crashing": each field
 * is asserted against the exact value the corresponding provider should
 * have produced.
 */
function ContextProbe() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  return (
    <div
      data-testid="probe"
      data-primary-main={theme.vars.palette.primary.main}
      data-has-query-client={String(queryClient !== undefined)}
    />
  );
}

/**
 * Exact fixture shape unit S8 used for its own I18nProvider proof
 * (`src/shared/i18n/I18nProvider.test.tsx`'s `Greeting`) — the published
 * `TFunction = (key, fallback, options?) => string` contract, so this test
 * exercises AppProviders' real I18nProvider the same way a Wave-2
 * `shared/ui`/`features/*` component will.
 */
function Greeting({ translate }: { translate: TFunction }) {
  return <p>{translate('demo.appProviders.greeting', 'Hello (fallback, should not render)')}</p>;
}

function ThrowingChild(): never {
  throw new Error('boom from AppProviders integration test');
}

describe('AppProviders', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    i18n.removeResourceBundle('en', 'translation');
  });

  it('provides theme + query client context to descendants (not just "renders without crashing")', () => {
    const { getByTestId } = render(
      <AppProviders>
        <ContextProbe />
      </AppProviders>,
    );

    const probe = getByTestId('probe');
    // Post-mount, theme.vars.* resolves to the bare var() form (see
    // BrandThemeProvider.test.tsx for why); the real colour value lives in
    // the injected stylesheet, asserted below through the FULL composed
    // AppProviders tree (not BrandThemeProvider in isolation).
    expect(probe.dataset['primaryMain']).toBe('var(--el-palette-primary-main)');
    expect(probe.dataset['hasQueryClient']).toBe('true');

    const styleText = [...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .join('\n')
      .toLowerCase();
    expect(styleText).toContain(
      `--el-palette-primary-main:${DEFAULT_BRAND_PACK.schemes.dark['primary.main']}`,
    );
  });

  it('RED/GREEN (c): I18nProvider resolves a real en.json key through the whole provider tree', () => {
    i18n.addResourceBundle('en', 'translation', { 'demo.appProviders.greeting': 'Hello from en.json' }, true, true);

    render(
      <AppProviders>
        <Greeting translate={t} />
      </AppProviders>,
    );

    expect(screen.getByText('Hello from en.json')).toBeTruthy();
  });

  it('RED case paired with the above: the same tree falls back gracefully when the key is missing', () => {
    render(
      <AppProviders>
        <Greeting translate={t} />
      </AppProviders>,
    );

    expect(screen.getByText('Hello (fallback, should not render)')).toBeTruthy();
  });

  it('the composed AppErrorBoundary catches a child render error without crashing the tree', () => {
    render(
      <AppProviders>
        <ThrowingChild />
      </AppProviders>,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
  });
});
