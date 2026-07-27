import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Dedicated vitest config for the R-M3/R-M5 RED/GREEN fixture runs driven by
 * scripts/check-gates-selftest.mjs. The fixtures live OUTSIDE src/ (they are
 * deliberately-failing tests and must never run in the real suite), but they
 * boot the REAL src/test/setup.ts so what is proven is the production fence,
 * not a copy.
 */
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: [resolve(APP_DIR, 'src/test/setup.ts')],
    include: ['tools/lint-rules/fixtures/msw/*.test.ts'],
  },
});
