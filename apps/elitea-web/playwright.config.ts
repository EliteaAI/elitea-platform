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
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    launchOptions: {
      args: ['--disable-web-security', '--allow-insecure-localhost', '--no-sandbox'],
    },
  },

  projects: [
    // ── Auth setup — runs before any browser project ──────────────────────
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
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
    // `up` exits once all services are healthy; `seed` then applies the DB
    // schema and creates the OIDC personas + RBAC grants that auth.setup logs
    // in as. Running only `up` left every persona non-existent, so no clean run
    // could authenticate (PR #82 validation, blocker 5).
    command: `${__dirname}/scripts/e2e-stack.sh up && ${__dirname}/scripts/e2e-stack.sh seed`,
    url: BASE_URL + '/app/',
    /*
     * `E2E_REUSE_STACK=1` forces reuse regardless of CI (issue #61, item 3).
     *
     * The visual job cannot use the plain `!CI` rule. Baselines are only valid
     * when rendered inside the pinned `mcr.microsoft.com/playwright:v1.62.0-noble`
     * image — a bare `npx playwright test` on the runner's own OS rasterises
     * fonts differently and every snapshot diffs. But the stack itself needs a
     * container runtime, so it has to come up on the HOST and the test run goes
     * into the container with `--network host`. In that shape `CI` is set, so
     * `reuseExistingServer` would be false and Playwright would try to bring the
     * stack up a second time — from inside a container that has no podman/docker.
     *
     * A job container instead of `docker run --network host` does not work
     * either: GitHub job containers do not share the runner's network namespace,
     * so `BASE_URL=http://localhost:8082` would not reach a host-side stack.
     */
    reuseExistingServer: process.env['E2E_REUSE_STACK'] === '1' || !process.env['CI'],
    // Allow up to 3 minutes for image builds + postgres migrations on a cold start.
    timeout: 180_000,
  },

  outputDir: 'playwright-results',
  snapshotDir: 'e2e/snapshots',
});
