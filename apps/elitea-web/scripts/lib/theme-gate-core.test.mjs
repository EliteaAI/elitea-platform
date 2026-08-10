import { describe, expect, it } from 'vitest';

import {
  checkExternalOrigins,
  checkForkedAssets,
  checkModeBranches,
  checkMuiSelectors,
  checkThemePalette,
} from './theme-gate-core.mjs';

const file = (path, text) => ({ path, text });

describe('§4.6 check 2 — mode branches', () => {
  it('flags palette.mode === and isDarkMode ? in ts/tsx', () => {
    const hits = checkModeBranches([
      file('src/a.ts', "const x = theme.palette.mode === 'dark' ? 1 : 2;"),
      file('src/b.tsx', 'const y = isDarkMode ? a : b;'),
    ]);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ path: 'src/a.ts', line: 1 });
  });

  it('has no exemptions — shared/brand is flagged too', () => {
    expect(
      checkModeBranches([file('src/shared/brand/buildTheme.ts', "x.palette.mode === 'dark'")]),
    ).toHaveLength(1);
  });

  it('ignores non-ts files and clean code', () => {
    expect(
      checkModeBranches([
        file('src/a.css', 'palette.mode === dark'),
        file('src/b.ts', 'const scheme = readSchemeToken();'),
      ]),
    ).toEqual([]);
  });

  it('does not flag a doc comment that merely mentions the banned pattern', () => {
    // Real bug found post-hoc: several shared/ui components document, in a
    // JSDoc block, that they deliberately avoid `palette.mode === 'dark'` —
    // the naive line-by-line grep flagged its own explanatory prose.
    expect(
      checkModeBranches([
        file(
          'src/a.ts',
          [
            '/**',
            " * Banned outright: `palette.mode === 'dark' ? a : b` (elitea/no-mode-branch).",
            ' * Ported via theme.applyStyles instead.',
            ' */',
            'const x = 1;',
          ].join('\n'),
        ),
      ]),
    ).toEqual([]);
  });

  it('still flags real code on the line right after a clean block comment', () => {
    expect(
      checkModeBranches([
        file(
          'src/a.ts',
          ['/** a clean comment, no mention */', "const x = theme.palette.mode === 'dark';"].join('\n'),
        ),
      ]),
    ).toHaveLength(1);
  });
});

describe('§4.6 check 3 — theme.palette outside shared/brand', () => {
  it('flags theme.palette. in tsx outside shared/brand', () => {
    expect(checkThemePalette([file('src/features/x/ui/A.tsx', 'theme.palette.primary.main')])).toHaveLength(1);
  });

  it('exempts shared/brand and ignores .ts (the spec grep is tsx-only)', () => {
    expect(
      checkThemePalette([
        file('src/shared/brand/buildTheme.tsx', 'theme.palette.primary.main'),
        file('src/features/x/lib/a.ts', 'theme.palette.primary.main'),
      ]),
    ).toEqual([]);
  });

  it('exempts the Wave 2 prefixes, and only those', () => {
    expect(
      checkThemePalette([
        file('src/features/onboarding/ui/A.tsx', 'theme.palette.primary.main'),
        file('src/entities/application/ui/B.tsx', 'theme.palette.primary.main'),
      ]),
    ).toEqual([]);
    expect(
      checkThemePalette([file('src/features/onboarding-next/ui/A.tsx', 'theme.palette.primary.main')]),
    ).toHaveLength(1);
  });
});

describe('§4.6 check 4 — MUI internal selectors', () => {
  it('flags .Mui*-* and .css-hash selectors outside mui-overrides', () => {
    const hits = checkMuiSelectors([
      file('src/features/x/ui/A.tsx', "const s = { '& .MuiButton-root': {} };"),
      file('src/features/x/ui/B.tsx', "const s = { '& .css-tgsonj': {} };"),
    ]);
    expect(hits).toHaveLength(2);
  });

  it('exempts shared/brand/mui-overrides', () => {
    expect(
      checkMuiSelectors([
        file('src/shared/brand/mui-overrides/button.tsx', "'& .MuiButton-root'"),
        file('src/features/x/lib/a.ts', "'& .MuiButton-root'"), // tsx-only, like check 3
      ]),
    ).toEqual([]);
  });

  it('exempts the Wave 2 prefixes, and only those', () => {
    expect(
      checkMuiSelectors([
        file('src/features/chat-messages/ui/A.tsx', "'& .MuiButton-root'"),
        file('src/pages/help-center/ui/B.tsx', "'& .MuiButton-root'"),
      ]),
    ).toEqual([]);
    expect(
      checkMuiSelectors([file('src/features/chat-messages-next/ui/A.tsx', "'& .MuiButton-root'")]),
    ).toHaveLength(1);
  });

  it('does not flag a doc comment explaining why a MUI selector is avoided', () => {
    // Real bug found post-hoc: multiple shared/ui components document, in a
    // JSDoc block, exactly which `.Mui*-*` selector R-T6 bans and why they
    // don't use it — the naive grep flagged the explanation itself.
    expect(
      checkMuiSelectors([
        file(
          'src/features/x/ui/A.tsx',
          [
            '/**',
            " * R-T6 (`elitea/no-mui-internal-selector`) confines `.MuiSlider-*`",
            ' * overrides to shared/brand/mui-overrides/, so this uses the real prop.',
            ' */',
            'const x = 1;',
          ].join('\n'),
        ),
      ]),
    ).toEqual([]);
  });
});

describe('§4.6 check 5 — forked assets', () => {
  it('flags -light/-dark svg and png pairs', () => {
    const hits = checkForkedAssets([
      'src/shared/assets/svg/ai-magic-light.svg',
      'src/shared/assets/svg/ai-magic-dark.svg',
      'src/shared/assets/img/Credentials_Light.png',
      'src/shared/assets/svg/logo.svg',
    ]);
    // Credentials_Light.png does not match the §4.6 regex (case-sensitive,
    // dash-separated) — exactly the spec's check; R-T8 review catches renames.
    expect(hits.map((h) => h.path)).toEqual([
      'src/shared/assets/svg/ai-magic-light.svg',
      'src/shared/assets/svg/ai-magic-dark.svg',
    ]);
  });
});

describe('§4.6 check 6 — external origins', () => {
  it('flags Google Fonts and GitHub avatar origins anywhere, including index.html', () => {
    const hits = checkExternalOrigins([
      file('index.html', '<link href="https://fonts.googleapis.com/css2?family=Inter">'),
      file('src/a.ts', "const u = 'https://fonts.gstatic.com/x.woff2';"),
      file('src/b.ts', "const a = 'https://avatars.githubusercontent.com/u/1';"),
      file('src/c.ts', "const ok = '/app/assets/inter.woff2';"),
    ]);
    expect(hits).toHaveLength(3);
  });

  it('still flags a URL in real code even though block-comment stripping runs first', () => {
    // Guards the fix for the check-2/3/4 comment false-positive: block
    // comments are stripped before matching, but `//` line comments are
    // deliberately left untouched (this check's own targets are `https://`
    // URLs, which contain `//`) — this proves that decision didn't also
    // blind this check to a real violation sitting right after one.
    const hits = checkExternalOrigins([
      file(
        'src/a.ts',
        [
          '/** unrelated clean comment */',
          "const u = 'https://fonts.gstatic.com/x.woff2';",
        ].join('\n'),
      ),
    ]);
    expect(hits).toHaveLength(1);
  });
});
