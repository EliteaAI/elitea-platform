/**
 * Playwright config (issue #60, unit V1).
 *
 * Projects:
 *   setup         — global setup: OIDC login per persona → saves storageState
 *   chromium      — 30 journeys against the real stack, chromium
 *   webkit        — same 30 journeys, webkit (spec §6.2)
 *
 * The `setup` project runs once before the browser projects; each browser
 * project depends on it so the storageState files are always fresh.
 *
 * webServer: shells out to e2e-stack.sh up/down so `npx playwright test`
 * works standalone. With `reuseExistingServer: !CI` a developer who already
 * ran `./scripts/e2e-stack.sh up` skips the rebuild.
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export const STORAGE_STATE = {
  member: path.join(__dirname, '.playwright-state', 'member.json'),
  admin: path.join(__dirname, '.playwright-state', 'admin.json'),
};

// Default 8082 locally: centry legacy stack occupies 8080; CI sets E2E_PORT=8080.
export const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:8082';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 4 : undefined,
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    // Trace on retry so failures in CI have full context.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // ── Auth setup — runs before any browser project ──────────────────────
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    // ── chromium ──────────────────────────────────────────────────────────
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE.member,
      },
      dependencies: ['setup'],
      testMatch: /journeys\/.+\.spec\.ts/,
    },

    // ── webkit (spec §6.2: "chromium + webkit") ───────────────────────────
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        storageState: STORAGE_STATE.member,
      },
      dependencies: ['setup'],
      testMatch: /journeys\/.+\.spec\.ts/,
    },
  ],

  // Bring up the real E2E stack before the test run.
  webServer: {
    // `e2e-stack.sh up` exits once all services are healthy.
    command: `${__dirname}/scripts/e2e-stack.sh up`,
    url: BASE_URL + '/app/',
    reuseExistingServer: !process.env['CI'],
    // Allow up to 3 minutes for image builds + postgres migrations on a cold start.
    timeout: 180_000,
  },

  outputDir: 'playwright-results',
  snapshotDir: 'e2e/snapshots',
});
