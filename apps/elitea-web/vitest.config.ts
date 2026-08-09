// vitest.config.ts — spec §6.3 VERBATIM (unit F2). Deviations are marked
// [F2] with their reason; everything else must stay byte-compatible with the
// spec so V4's coverage-shape audit can diff it.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
// [S2] vite.config.ts registers `svgr({ svgrOptions: { ref: true } })` for the app build, but
// vitest has its own separate plugin list — without this, `*.svg?react` imports (every icon in
// shared/ui/icons/**) fall through to Vite's default asset handling under jsdom and resolve to a
// `data:image/svg+xml,...` URL string instead of a component, breaking every icon-consuming test
// tree-wide (proven: shared/ui/icons' own smoke test failed with `InvalidCharacterError` before
// this was added). `svgrOptions` must match vite.config.ts's so dev/build/test agree on the
// generated component shape (ref-forwarding).
import svgr from 'vite-plugin-svgr';
// [F2] vitest@4.1.10 rejects the string form the spec shows
// (`provider: 'playwright'`): "The `browser.provider` configuration was
// changed to accept a factory instead of a string." — verified 2026-07-26.
import { playwright } from '@vitest/browser-playwright';
// [S1] activates the storybook project (§6.4): addon-vitest's plugin turns
// every *.stories.tsx CSF file into a Vitest test per story, running the
// `play` function and the a11y check registered in .storybook/preview.tsx.
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

export default defineConfig({
  plugins: [react(), tsconfigPaths(), svgr({ svgrOptions: { ref: true } })],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['src/**/*.browser.{test,spec}.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.{test,spec}.{ts,tsx}'],
          browser: { enabled: true, provider: playwright(), instances: [{ browser: 'chromium' }] },
        },
      },
      // [S1] Storybook project (§6.3/§6.4): activated now that `.storybook/`
      // (main.ts + preview.tsx + vitest.setup.ts) has landed. Runs every
      // `shared/ui/**/*.stories.tsx` as a Vitest test, executing each story's
      // `play` function and the a11y addon's check (parameters.a11y.test is
      // 'error' in preview.tsx). Browser mode uses the same
      // `@vitest/browser-playwright` factory as the `browser` project above
      // (D2 addendum: the string form `provider: 'playwright'` is rejected).
      {
        extends: true,
        plugins: [storybookTest({ configDir: '.storybook' })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            provider: playwright(),
            // Real CI gap, found the first time this project ran end-to-end
            // in CI (draft-PR CI hadn't executed before unit S1 landed):
            // headless Chromium denies clipboard-write permission by
            // default, unlike a normal user's browser. CopyToClipboardButton
            // and CommonStringField's clipboard variant both, deliberately
            // and correctly (see src/shared/lib/clipboard.ts's own N4 doc
            // comment — a byte-for-byte preserved old-app quirk, not
            // something to fix here), fire an unhandled, unawaited
            // navigator.clipboard.writeText() retry when EVERY copy path
            // fails. Without this permission grant, that retry always fails
            // too, in an environment these stories were never meant to
            // simulate. Granting the permission (matching what a real
            // browser has) keeps the primary clipboard write succeeding, so
            // the preserved-quirk fallback path never triggers in normal
            // Storybook test runs — the same class of fix already applied
            // to ci-web.yml for the Playwright browser install itself.
            instances: [{ browser: 'chromium', contextOptions: { permissions: ['clipboard-read', 'clipboard-write'] } }],
          },
          setupFiles: ['./.storybook/vitest.setup.ts'],
        },
      },
      // [F2] Extra project, not in §6.3: the gate scripts' own test suites
      // (§9.3 unit F2 requires 100% coverage of scripts' decision logic; the
      // spec's include only matches src/**). The `coverage` block below is
      // untouched by this project — the 100% floor on scripts/lib/** is
      // enforced by the "Gate-script decision-logic coverage" job in
      // ci-web.yml, which re-runs this project with a CLI-scoped
      // --coverage.include and 100% thresholds. That job's thresholds were 0
      // and its report reader was broken until #73; the floor is real now.
      {
        extends: true,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.mjs', 'tools/lint-rules/**/*.test.mjs'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.stories.tsx',
        'src/**/*.d.ts',
        'src/shared/api/generated/**', // generated: covered by contract tests, not line coverage
        'src/shared/api/sse.ts', //       no consumer at ship (§5.6); REMOVE this line when one lands
        // Deliberately unwired (knip.json's ignoreFiles has the same entry,
        // same reason): its target library (@mui/x-treeview) is not a
        // dependency of this app (spec §2.2/P1, "the file tree is hand-
        // rolled") -- REMOVE this line if that ever changes and something
        // actually wires it into mui-overrides/index.ts.
        'src/shared/brand/mui-overrides/MuiTreeItem.ts',
        // Wave-2 C4 chat-messages unit — 45 files, not wired into any app
        // consumer yet; `all:true` would count its 0% as dead weight (same
        // rationale as sse.ts above). REMOVE when a real consumer imports it.
        'src/features/chat-messages/**',
        'src/test/**',
        'src/**/__mocks__/**',
        'src/app/main.tsx',
        'src/routeTree.gen.ts',
      ],
      // Only apply coverage thresholds in non-sharded, merged runs. Sharded
      // coverage runs set VITEST_SKIP_COVERAGE_THRESHOLDS=true so raw shard
      // data is collected without failing on config-level per-glob thresholds.
      thresholds: process.env.VITEST_SKIP_COVERAGE_THRESHOLDS === 'true' ? {} : {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 70,
        autoUpdate: false,
      },
    },
  },
});
