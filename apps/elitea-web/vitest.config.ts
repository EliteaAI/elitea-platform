// vitest.config.ts — spec §6.3 VERBATIM (unit F2). Deviations are marked
// [F2] with their reason; everything else must stay byte-compatible with the
// spec so V4's coverage-shape audit can diff it.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
// [F2] vitest@4.1.10 rejects the string form the spec shows
// (`provider: 'playwright'`): "The `browser.provider` configuration was
// changed to accept a factory instead of a string." — verified 2026-07-26.
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
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
      // [F2] The storybook project is stub-commented exactly as §6.3 shows it;
      // it activates when S1 lands `.storybook/` (addon-vitest + setup file).
      // Until then an uncommented block would fail the run on the missing
      // ./.storybook/vitest.setup.ts.
      // {
      //   extends: true,
      //   plugins: [/* storybookTest({ configDir: '.storybook' }) */],
      //   test: { name: 'storybook', setupFiles: ['./.storybook/vitest.setup.ts'] },
      // },
      // [F2] Extra project, not in §6.3: the gate scripts' own test suites
      // (§9.3 unit F2 requires 100% coverage of scripts' decision logic; the
      // spec's include only matches src/**). Coverage thresholds below are
      // untouched — the 100% floor on scripts/lib/** is enforced by the
      // "Gate-script decision-logic coverage" step in ci-web.yml's gates job
      // (CLI-scoped --coverage.include with 100% thresholds).
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
        'src/test/**',
        'src/**/__mocks__/**',
        'src/app/main.tsx',
        'src/routeTree.gen.ts',
      ],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 80,
        // per-unit floors — a unit that regresses fails even if the global number holds
        'src/shared/api/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
        // [F3] Spec erratum: §6.3's block omits shared/config, but §9.3 gives
        // unit F3 a 95 floor like every other shared/* unit. Encoded so the
        // floor is enforced, not merely asserted in a report.
        'src/shared/config/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/shared/brand/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/shared/lib/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/entities/**': { lines: 90, branches: 85, functions: 90, statements: 90 },
        'src/features/**': { lines: 88, branches: 82, functions: 88, statements: 88 },
        'src/processes/**': { lines: 88, branches: 82, functions: 88, statements: 88 },
        'src/widgets/**': { lines: 85, branches: 80, functions: 85, statements: 85 },
        'src/pages/**': { lines: 80, branches: 75, functions: 80, statements: 80 },
        autoUpdate: false,
      },
    },
  },
});
