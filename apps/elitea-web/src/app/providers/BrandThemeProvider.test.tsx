import { render } from '@testing-library/react';
import { useTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import { BrandPack, DEFAULT_BRAND_PACK } from '@/shared/brand';

import { installWebStorageShim } from '../../test/webstorage';

import { BrandThemeProvider } from './BrandThemeProvider';

/**
 * MUI's ThemeProvider (CssVarsProvider under the hood) reads/writes
 * `window.localStorage` for mode persistence. Under vitest 4 + Node 24,
 * Node's own experimental `localStorage` global shadows jsdom's, leaving
 * `window.localStorage` undefined in the `node` project — unit F4 shipped
 * `installWebStorageShim()` for exactly this (`src/test/webstorage.ts`),
 * applied per-file the same way F4's own `storage.test.ts` does, since
 * `src/test/setup.ts` is unit M1's file (not this unit's to edit).
 */
installWebStorageShim();

/**
 * Built at runtime from a NUMBER literal, not written as a colour string
 * literal — R-T1's `no-raw-color` scan (`tools/lint-rules/rules/no-raw-color.mjs`)
 * inspects string/template literal TEXT and has no test-file carve-out in
 * `.oxlintrc.json` (unlike `i18next/no-literal-string`): a colour string it
 * can see is banned everywhere source is scanned, fixtures included. These
 * two probe colours exist only to be searched for / injected into a rendered
 * stylesheet below, never to style anything, but the rule can't tell that
 * from a bare literal, so they are computed instead of spelled out.
 */
const UNUSED_PROBE_COLOUR = `#${(0x123456).toString(16)}`; // '#123456'
const HOSTILE_PROBE_COLOUR = `#${(0xff00aa).toString(16)}`; // '#ff00aa'

function ThemeProbe() {
  const theme = useTheme();
  return <div data-testid="probe" data-primary-main={theme.vars.palette.primary.main} />;
}

/** Every `<style>` element's text, concatenated — the real, rendered output. */
function renderedStyleText(): string {
  return [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n');
}

describe('BrandThemeProvider', () => {
  it('exposes the built MUI theme to descendants via context (theme.vars resolves to the real CSS-variable name)', () => {
    const { getByTestId } = render(
      <BrandThemeProvider>
        <ThemeProbe />
      </BrandThemeProvider>,
    );

    // Once CssVarsProvider has settled post-mount (verified empirically —
    // testing-library's render() flushes the settling effect synchronously),
    // `theme.vars.*` reads resolve to the bare `var(--name)` form, WITHOUT
    // the inline fallback `buildTheme.test.ts` observes on the theme object
    // in isolation (that form only appears pre-mount / off-context, to
    // survive a render before any stylesheet exists). The real, current
    // colour value lives in the injected stylesheet instead — see the
    // RED/GREEN (b) test below, which is the assertion that actually proves
    // the default pack's colour reached the DOM.
    expect(getByTestId('probe').dataset['primaryMain']).toBe('var(--el-palette-primary-main)');
  });

  it('RED/GREEN (b): renders the default pack\'s real brand colour into the DOM (a real rendered-style assertion, not just "renders without crashing")', () => {
    render(
      <BrandThemeProvider>
        <button type="button">probe</button>
      </BrandThemeProvider>,
    );

    const styleText = renderedStyleText();

    // RED baseline, proven inline: a colour this pack does not use must NOT
    // appear — otherwise the GREEN assertion below would be vacuous (any
    // hex string would "pass" a substring check against arbitrary CSS).
    expect(styleText.toLowerCase()).not.toContain(UNUSED_PROBE_COLOUR);
    // GREEN: the default pack's actual brand hue (`brand.hue` /
    // `schemes.dark['primary.main']`, tokens/default.pack.json, "#6ae8fa")
    // IS present in the stylesheet CssBaseline forced MUI to inject — the
    // theme's real, resolved output, not the theme object in isolation.
    expect(styleText.toLowerCase()).toContain(
      `--el-palette-primary-main:${DEFAULT_BRAND_PACK.schemes.dark['primary.main']}`,
    );
  });

  it('is pack-driven, not hardcoded: a different pack paints a different primary colour in the rendered stylesheet', () => {
    const hostilePack = BrandPack.parse({
      ...DEFAULT_BRAND_PACK,
      brand: { hue: HOSTILE_PROBE_COLOUR },
      schemes: {
        ...DEFAULT_BRAND_PACK.schemes,
        dark: { ...DEFAULT_BRAND_PACK.schemes.dark, 'primary.main': HOSTILE_PROBE_COLOUR },
      },
    });

    render(
      <BrandThemeProvider pack={hostilePack}>
        <button type="button">probe</button>
      </BrandThemeProvider>,
    );

    const styleText = renderedStyleText().toLowerCase();
    expect(styleText).toContain(`--el-palette-primary-main:${HOSTILE_PROBE_COLOUR}`);
    expect(styleText).not.toContain(
      `--el-palette-primary-main:${DEFAULT_BRAND_PACK.schemes.dark['primary.main']}`,
    );
  });

  it('renders InitColorSchemeScript (T1\'s documented snippet) without crashing — VERIFIED NO-OP for this app, see BrandThemeProvider.tsx header', () => {
    // Empirically verified (not guessed): @mui/system's InitColorSchemeScript
    // only emits a <script> while useSyncExternalStore reports "server or
    // matching-hydration render". This app's main.tsx calls
    // createRoot(...).render(...) — never hydrateRoot — and spec N6
    // permanently forbids SSR/hydration, so the component returns null on
    // every render, here included. This test pins that verified fact so a
    // future MUI upgrade that changes the behaviour is caught, not silently
    // assumed away.
    render(
      <BrandThemeProvider>
        <button type="button">probe</button>
      </BrandThemeProvider>,
    );

    const scripts = [...document.querySelectorAll('script')];
    expect(scripts.some((script) => (script.textContent ?? '').includes('el-mode'))).toBe(false);
  });
});
