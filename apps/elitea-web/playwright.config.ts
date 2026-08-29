/**
 * Playwright config (issue #60, unit V1).
 *
 * Projects:
 *   setup         — global setup: OIDC login per persona → saves storageState
 *   chromium      — 30 journeys against the real stack, chromium
 *   webkit        — same 30 journeys, webkit (spec §6.2)
 *   chat-stream   — the #284 chat journey, against the FULL standalone stack
 *                   (runtime plane + worker + mock LLM); see that project's
 *                   own note and `scripts/chat-stream-e2e.sh`
 *   index-stream  — the #93 index journey, same stack plus `seed-index`;
 *                   see `scripts/index-stream-e2e.sh`
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
  /**
   * The #284 chat driver. A persona of its own because it OWNS a personal
   * project, and the app selects the signed-in user's personal project over
   * the one `auth.setup.ts` writes to storage — handing member/admin one moves
   * every other journey off project 1 (measured, see the seeder's note).
   */
  chat: path.join(__dirname, '.playwright-state', 'chat.json'),
};

/**
 * What `scripts/e2e-stack.sh seed` says it wrote into `centry.audit_events`:
 * the row count, the first and last timestamps, and the local day they fall on
 * (issue #214). Journey 29 freezes its browser clock to that day rather than
 * reading the wall clock, so the page's `Today` window and the fixture cannot
 * end up on opposite sides of a midnight.
 *
 * It lives beside the persona storageState because it is the same kind of
 * thing: per-run provisioning output, written by the seed, read by the tests,
 * gitignored, and inside the directory CI mounts into the Playwright container.
 */
export const AUDIT_FIXTURE_ANCHOR = path.join(__dirname, '.playwright-state', 'audit-fixture.json');

// Default 8082 locally: centry legacy stack occupies 8080; CI sets E2E_PORT=8080.
export const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:8082';

/**
 * The IANA zone EVERY browser context runs in, and the SAME zone
 * `scripts/e2e-stack.sh` computes its fixtures' start of day in (issue #214).
 *
 * Two clocks decide whether a seeded row falls inside a calendar-day filter,
 * and until now nothing made them agree:
 *
 *  - the BROWSER's. The admin Audit Trail opens on a `Today` preset
 *    (`src/pages/admin/auditFormat.ts`), whose `startOfDay` is
 *    `setHours(0,0,0,0)` on a `new Date()` — local midnight, in whatever zone
 *    the runner's OS happens to be in, sent to the server as an instant.
 *  - the DATABASE's. The audit fixture anchors its rows on
 *    `date_trunc('day', now())` so they land inside that window — in whatever
 *    zone the postgres session happens to be in.
 *
 * The two coincided in CI only because both sides inherited UTC by accident. At
 * 00:15 America/New_York they did not: three of the four fixture rows landed on
 * yesterday, and journey 29 failed "element not found" on rows that were
 * plainly in the table. Widening the filter or retrying would each have hidden
 * that. Pinning ONE zone and deriving BOTH day boundaries from it makes them
 * agree by construction, at every time of day.
 *
 * `E2E_TZ` overrides it, and must reach the seed and the browser TOGETHER —
 * `webServer.command` below runs the seed, so one exported variable does both.
 * Set it to a zone whose local time is a few minutes past midnight to run the
 * suite as if it were midnight, without touching any clock:
 *
 *   # at 13:05 UTC, Pacific/Guadalcanal (UTC+11) is 00:05 the next day
 *   E2E_TZ=Pacific/Guadalcanal npx playwright test --project=chromium
 *
 * UTC by default, so CI and every existing local invocation keep the day
 * boundary they already had. The difference is that they now HAVE one, rather
 * than borrowing whatever the runner and the database happened to be set to.
 */
export const E2E_TIMEZONE = process.env['E2E_TZ'] ?? 'UTC';

/*
 * Chromium-only launch flags — applied per project, never in the shared `use:`.
 *
 * They used to sit in the shared block, which handed them to WebKit as well.
 * Linux WebKit refuses to start on an unknown argument:
 *
 *   <launching> …/webkit-2336/pw_run.sh --disable-web-security …
 *   [err] Cannot parse arguments: Unknown option --disable-web-security
 *   Error: browserType.launch: Target page, context or browser has been closed
 *
 * — every webkit test failed at launch, on all three attempts, the first time
 * the suite ran in CI (issue #154). macOS WebKit tolerates the same flags, so
 * the whole webkit project passed locally while being unrunnable on Linux.
 * They are Chromium flags and have never meant anything to WebKit.
 */
const CHROMIUM_LAUNCH_OPTIONS = {
  args: ['--disable-web-security', '--allow-insecure-localhost', '--no-sandbox'],
};

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
    // Shared, not per-project: every project drives the same seeded stack, so
    // every project must read the same day boundary out of it. See E2E_TIMEZONE.
    timezoneId: E2E_TIMEZONE,
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
      use: { ...devices['Desktop Chrome'], launchOptions: CHROMIUM_LAUNCH_OPTIONS },
    },

    // ── chromium ──────────────────────────────────────────────────────────
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE.member,
        launchOptions: CHROMIUM_LAUNCH_OPTIONS,
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

    /*
     * ── visual (release tags only, via `--grep @visual`) ───────────────────
     *
     * Its own project because the journey projects match `journeys/**` only —
     * `e2e/visual/**` was invisible to them, and `--grep @visual` reported
     * "No tests found" while looking like a suite that simply had nothing to
     * report.
     *
     * Chromium ONLY, deliberately: a baseline is valid for exactly one
     * rasteriser, and running webkit against chromium's PNGs would diff every
     * screen for reasons unrelated to the UI. Adding webkit means a second set
     * of baselines, not a second project against the same set.
     */
    {
      name: 'visual',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE.member,
        launchOptions: CHROMIUM_LAUNCH_OPTIONS,
        // Pinned so a snapshot's geometry never depends on the runner's
        // defaults. Matches the 1602x848 CSS geometry of the production
        // reference set in parity/screenshot-index.json.
        viewport: { width: 1602, height: 848 },
        deviceScaleFactor: 2,
      },
      dependencies: ['setup'],
      testMatch: /visual\/.+\.spec\.ts/,
    },

    /*
     * ── chat-stream (#284) — the chat definition-of-done journey ───────────
     *
     * Its own project because it is the one journey that cannot run against
     * `docker-compose.e2e-standalone.yml`: an agent turn needs the runtime
     * plane, the worker and a model backend, none of which that stack has.
     * `scripts/chat-stream-e2e.sh` brings up the FULL standalone stack and
     * points this project at it, so it never runs by accident against a stack
     * that would fail it for the wrong reason.
     *
     * Chromium only: this asserts a transport and a render, not a rasteriser,
     * and a second engine would double the stack time for no new signal.
     */
    {
      name: 'chat-stream',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE.chat,
        launchOptions: CHROMIUM_LAUNCH_OPTIONS,
      },
      dependencies: ['setup'],
      // Pinned to `chat.*` rather than all of `streaming/**`: this directory now
      // holds two journeys with DIFFERENT seeding needs, and a broad match here
      // would hand the index journey to a runner that never ran `seed-index`.
      testMatch: /streaming\/chat\..+\.spec\.ts/,
      /*
       * Serial, overriding the top-level `fullyParallel`, for the same class of
       * reason as `index-stream` below and one specific number: elitea-main
       * admits FOUR concurrent replay streams per principal
       * (`internal/api/v2/executions/events_admission.go`), and both journeys
       * sign in as the same chat persona. Each one holds an execution stream
       * for the length of a turn while the app also holds its notifications
       * stream, so two of them in parallel sit on the edge of that budget.
       * Measured: run together over three workers, the second journey's
       * `/executions/{id}/events` answered 429 and the failure read as "the
       * browser cannot read the stream" — a statement about the harness, not
       * the feature. Serially, both pass.
       *
       * KNOWN LIMIT of this override: `fullyParallel: false` orders tests
       * WITHIN a file; separate spec files still spread across workers. The
       * budget holds because each journey's execution stream is short-lived,
       * but if this project ever answers 429 again the next lever is
       * `--workers=1` on the chat-stream invocation, not a broader rewrite.
       */
      fullyParallel: false,
    },

    /*
     * ── index-stream (#93 Surface A) — the index definition-of-done journey ──
     *
     * Its own project for the same reason `chat-stream` is: it needs the FULL
     * standalone stack (runtime plane + agent worker), plus the `seed-index`
     * rows. `scripts/index-stream-e2e.sh` provisions both and points this
     * project at the result, so it never runs by accident against a stack that
     * would fail it for the wrong reason.
     *
     * Shares `STORAGE_STATE.chat`: that persona OWNS a personal project, and
     * the index permissions — including `models.applications.index_meta.details`,
     * which project 1 does NOT grant — are seeded there.
     *
     * Chromium only: this asserts a transport and a render, not a rasteriser.
     */
    {
      name: 'index-stream',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE.chat,
        launchOptions: CHROMIUM_LAUNCH_OPTIONS,
      },
      dependencies: ['setup'],
      testMatch: /streaming\/index\..+\.spec\.ts/,
      /*
       * Serial, overriding the top-level `fullyParallel`. These two tests drive
       * the SAME toolkit through the SAME single-consumer execution plane, so
       * running them against each other measures the stack's concurrency, not
       * the feature. Measured on the standalone stack: with the suite spread
       * over three workers, elitea-main's pool saturated and
       * `list project configurations` timed out, which surfaced as the start
       * POST never being answered — a 40s `waitForResponse` timeout that reads
       * exactly like "the Index button does nothing". Serially, 3x3 green.
       */
      fullyParallel: false,
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
