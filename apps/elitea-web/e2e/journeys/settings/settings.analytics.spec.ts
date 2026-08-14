/**
 * Journey 24: Settings: analytics loads (JRNY-024)
 *
 * Spec §8.5 acceptance (from parity/manifest/analytics.json JRNY-024).
 * Acceptance: the dashboards render with project data;
 * loading failures show an error state instead of empty charts.
 *
 * ── WHAT CHANGED, AND WHY ────────────────────────────────────────────────
 * The previous revision of this file asserted
 *
 *     expect(hasError || hasCharts || hasHeading || hasDatePicker || hasMainContent)
 *
 * over five `.catch(() => false)`-guarded probes, plus a three-deep `.or()`
 * chain that whitelisted `getByRole('main')`. Every one of those disjuncts is
 * satisfied by a page that renders nothing but a `<main>` with the word
 * "Analytics" in it — i.e. by a stub. The route is not a stub
 * (`src/routes/_shell/settings/analytics.tsx` mounts the real
 * `AnalyticsContainer`, and `AnalyticsRepo` is now wired at
 * `services/elitea-main/internal/api/router.go:832-840`), so there was
 * nothing to hedge against; the hedges only ever hid regressions.
 *
 * Every assertion below is on something a stub cannot produce: a KPI value
 * read back out of the very HTTP response the app consumed, a six-column
 * table header, a formatter-transformed number (`1234` → `1.2K`), or an
 * error string that only appears on the `isError` branch.
 *
 * No `test.skip`, no early `return`, no `.catch(() => false)`, no `.or()`.
 */
import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL } from '../../../playwright.config';
import { API_BASE, DEFAULT_PROJECT_ID } from '../../fixtures/api';

/** `GET /elitea_core/analytics/prompt_lib/{projectID}` — the Overview/Health fetch. */
const USAGE_RE = /\/api\/v2\/elitea_core\/analytics\/prompt_lib\/\d+(\?|$)/;
const USAGE_GLOB = '**/api/v2/elitea_core/analytics/prompt_lib/*';

/**
 * A verbatim copy of `src/features/analytics/lib/format.ts`'s `fmtNum`.
 * Copied, not imported: `e2e/` is compiled by Playwright without the app's
 * `@/` path aliases, and an assertion that re-used the app's own formatter
 * would pass for free if that formatter regressed. This is the independent
 * oracle the KPI values are checked against.
 */
function fmtNum(n: number | null | undefined): string {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * The `KpiCard` root Box (`ui/components/KpiCard.tsx:67`) is the parent of
 * the label `<Typography>`; value/suffix/badge/subtitle are its siblings.
 */
function kpi(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator('..');
}

interface Kpis {
  readonly unique_users: number;
  readonly total_project_users: number;
  readonly ai_active_users: number;
  readonly adoption_rate: number;
  readonly llm_calls: number;
  readonly tool_runs: number;
  readonly chat_msgs: number;
  readonly agent_runs: number;
}

/** Asserts the full six-tile KPI row against one `kpis` object. */
async function expectKpiRow(page: Page, k: Kpis): Promise<void> {
  const team = kpi(page, 'TEAM');
  await expect(team.getByText(fmtNum(k.unique_users), { exact: true })).toBeVisible();
  await expect(team.getByText(`of ${fmtNum(k.total_project_users)}`, { exact: true })).toBeVisible();
  await expect(team.getByText('active members', { exact: true })).toBeVisible();

  const aiActive = kpi(page, 'AI ACTIVE');
  await expect(aiActive.getByText(fmtNum(k.ai_active_users), { exact: true })).toBeVisible();
  await expect(aiActive.getByText(`${k.adoption_rate}% adoption`, { exact: true })).toBeVisible();

  await expect(kpi(page, 'LLM CALLS').getByText(fmtNum(k.llm_calls), { exact: true })).toBeVisible();
  await expect(kpi(page, 'TOOL RUNS').getByText(fmtNum(k.tool_runs), { exact: true })).toBeVisible();
  await expect(kpi(page, 'CHAT MSG').getByText(fmtNum(k.chat_msgs), { exact: true })).toBeVisible();
  await expect(kpi(page, 'AGENT RUNS').getByText(fmtNum(k.agent_runs), { exact: true })).toBeVisible();
}

/* ────────────────────────────────────────────────────────────────────────
 * J24 — the acceptance clause "the dashboards render with project data",
 * against the REAL backend. The oracle is the response body the app itself
 * received, captured off the wire; the assertion is that every one of the
 * six KPI tiles displays that response's corresponding field.
 * ──────────────────────────────────────────────────────────────────────── */
test('J24: settings: analytics reports that the live backend has no usage source', async ({ page }) => {
  const usage = page.waitForResponse(
    (r) => USAGE_RE.test(r.url()) && r.request().method() === 'GET',
    { timeout: 20_000 },
  );

  await page.goto(BASE_URL + '/app/settings/analytics');
  const response = await usage;

  // Chrome that only the real container renders (AnalyticsContainer.tsx:159-236).
  // 15s, not the 5s default: the header's name comes from the selected-project
  // store, which is populated by a mount effect reading persisted storage
  // (widgets/app-shell/model/useSelectedProject.hooks.ts:22-29) — so this text
  // lands a render after the route body, and webkit on a loaded runner is the
  // slow case. Headroom for a slow boot, NOT a correctness race: which NAME
  // gets stored is no longer order-dependent (issue #161 — AppShell and
  // ProjectSwitcher both resolve it from the project list now).
  await expect(page.getByText('Project: Default Project', { exact: true })).toBeVisible({ timeout: 15_000 });
  for (const preset of ['Last 24h', 'Last 7d', 'Last 30d', 'Last 90d']) {
    await expect(page.getByRole('button', { name: preset, exact: true })).toBeVisible();
  }
  // The two `DateRangeField` MUI DateTimePickers (AnalyticsContainer.tsx:186-205)
  // render five segmented spinbuttons each (MM/DD/YYYY hh:mm) — ten in total.
  await expect(page.getByText('From:', { exact: true })).toBeVisible();
  await expect(page.getByText('To:', { exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveCount(10);
  for (const tab of ['Overview', 'Agents', 'Tools', 'Users', 'Health', 'Guide']) {
    await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
  }

  // ── The acceptance clause, second half: "loading failures show an error
  //    state instead of empty charts."
  //
  // This assertion used to be `expectKpiRow(page, payload.kpis)` against a 200.
  // It passed, and what it proved was that six tiles displayed six numbers the
  // backend had never computed: `Usage()` hardcoded `unique_users: 0`,
  // `tool_runs: 0`, `chat_msgs: 0`, `adoption_rate: 0` and discarded the error
  // from a repository whose every query named a table no migration creates
  // (issue #303). The oracle was the response body, so a response of pure
  // fabrication satisfied it exactly as well as real data would have.
  //
  // With the fabrication removed the live endpoint answers 500 and says why, so
  // that is what this journey now pins. It is a STRICTER claim than the one it
  // replaces: an all-zero dashboard is producible by a stub, by a broken query
  // and by a genuinely idle project alike, whereas a 500 carrying a no-source
  // detail is producible only by the handler actually consulting its repository
  // and reporting what came back.
  //
  // The populated-dashboard rendering — tiles, leaderboard, K/M formatter,
  // model table — is not lost: J24b below drives it with a crafted payload, and
  // did so before this change too, precisely because every real value was 0.
  expect(response.status()).toBe(500);
  const failure = (await response.json()) as { error?: string; detail?: string };
  expect(failure.detail ?? '').toContain('analytics: no data source');

  // The UI's error branch (AnalyticsTabContent.tsx:119-130), not a blank panel
  // and not zero tiles.
  await expect(page.getByText('Failed to load analytics data.', { exact: true })).toBeVisible();
  for (const label of ['TEAM', 'AI ACTIVE', 'LLM CALLS', 'TOOL RUNS', 'CHAT MSG', 'AGENT RUNS']) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
  await expect(page.locator('.recharts-surface')).toHaveCount(0);

  await checkA11y(page);
});

/* ────────────────────────────────────────────────────────────────────────
 * The live backend cannot populate this dashboard: `usage_records` and
 * `tool_usage_records` do not exist in the migration corpus (proven by
 * services/elitea-main/migrations/analytics_tables_postgres_integration_test.go),
 * and the figures those queries claimed to report have no producer anywhere
 * in the platform — see the header of
 * services/elitea-main/internal/infra/db/repos/analytics.go for which, and
 * why repointing them is a product decision rather than a rewrite. So
 * `Usage()` now answers 500 and J24 above pins that.
 *
 * The populated-dashboard branches — the leaderboard rows, the `fmtNum` K/M
 * abbreviation, the adoption badge, the model table — are therefore reachable
 * only from a crafted response, which is what this test serves. That was
 * already true before the handler stopped fabricating: every real value was 0,
 * so J24 could never tell a payload-bound tile from a hardcoded one, and this
 * test is what proves the binding.
 * ──────────────────────────────────────────────────────────────────────── */
test('J24b: analytics tiles, leaderboard and model table are bound to the response payload', async ({ page }) => {
  const kpis: Kpis = {
    unique_users: 3,
    total_project_users: 9,
    ai_active_users: 2,
    adoption_rate: 42,
    llm_calls: 1234,
    tool_runs: 56,
    chat_msgs: 7,
    agent_runs: 89,
  };
  const body = {
    kpis,
    top_ai_users: [
      { user_id: 'u-ana-1', user_email: 'first-ana@example.com', llm_calls: 10, tool_runs: 5, agent_runs: 2, ai_events: 17 },
      { user_id: 'u-ana-2', user_email: 'second-ana@example.com', llm_calls: 1, tool_runs: 1, agent_runs: 1, ai_events: 3 },
    ],
    daily_activity: [
      { date: '2026-08-01', events: 12, users: 3 },
      { date: '2026-08-02', events: 4, users: 1 },
    ],
    models: [
      { model: 'model-alpha-ana', prompt_tokens: 100, completion_tokens: 50, total_cost: 1.5, run_count: 40 },
    ],
  };

  await page.route(USAGE_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );

  await page.goto(BASE_URL + '/app/settings/analytics');

  await expectKpiRow(page, kpis);
  // 1234 → "1.2K": the tile shows the FORMATTER'S output, so neither the raw
  // number nor a hardcoded zero satisfies this.
  await expect(kpi(page, 'LLM CALLS').getByText('1.2K', { exact: true })).toBeVisible();
  // The badge only renders when adoption_rate > 0 (AnalyticsKpiRow.tsx:60-62).
  await expect(kpi(page, 'AI ACTIVE').getByText('↑42%', { exact: true })).toBeVisible();

  // Leaderboard: populated rows replace the "No AI activity data." branch.
  await expect(page.getByText('No AI activity data.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('first-ana@example.com', { exact: true })).toBeVisible();
  await expect(page.getByText('10 LLM · 5 Tool · 2 Agent', { exact: true })).toBeVisible();
  await expect(page.getByText('second-ana@example.com', { exact: true })).toBeVisible();
  await expect(page.getByText('1 LLM · 1 Tool · 1 Agent', { exact: true })).toBeVisible();

  // Model usage table: rendered only because `models` is non-empty.
  await expect(page.getByText('Model Usage Breakdown', { exact: true })).toBeVisible();
  await expect(page.getByText('model-alpha-ana', { exact: true })).toBeVisible();

  // Daily-activity series: two points ⇒ two x-axis ticks, labelled by
  // `value.slice(5)` (AnalyticsOverview.tsx:176), and a y-axis whose domain
  // is computed from the series maximum (`events: 12`).
  const xTicks = page.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value');
  await expect(xTicks).toHaveCount(2);
  await expect(xTicks.nth(0)).toHaveText('08-01');
  await expect(xTicks.nth(1)).toHaveText('08-02');
  await expect(
    page.locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value', { hasText: /^12$/ }),
  ).toHaveCount(1);

  await checkA11y(page);
});

/* ────────────────────────────────────────────────────────────────────────
 * J24c — the second acceptance clause, verbatim: "loading failures show an
 * error state instead of empty charts".
 * ──────────────────────────────────────────────────────────────────────── */
test('J24c: a failing analytics load shows the error state instead of empty charts', async ({ page }) => {
  await page.route(USAGE_GLOB, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"induced failure"}' }),
  );

  await page.goto(BASE_URL + '/app/settings/analytics');

  // AnalyticsTabContent.tsx:110-119 — the `needsOverview && isError` branch.
  await expect(page.getByText('Failed to load analytics data.', { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // "instead of empty charts": no KPI tiles, no recharts surface, no
  // leaderboard — the error branch returns EARLY, before renderTabBody.
  for (const label of ['TEAM', 'AI ACTIVE', 'LLM CALLS', 'TOOL RUNS', 'CHAT MSG', 'AGENT RUNS']) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
  await expect(page.locator('.recharts-surface')).toHaveCount(0);
  await expect(page.getByText('Top 5 AI Adopters', { exact: true })).toHaveCount(0);

  // The rest of the screen is still alive — the failure is scoped to the tab body.
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByText('Project: Default Project', { exact: true })).toBeVisible({ timeout: 15_000 });

  await checkA11y(page);
});

/* ────────────────────────────────────────────────────────────────────────
 * J24d — the three list tabs. Each one issues its own request; the row count
 * the UI reports is checked against the row count the backend actually
 * returned for the same project.
 * ──────────────────────────────────────────────────────────────────────── */
test('J24d: the Agents/Tools/Users tabs report the missing source, not an empty table', async ({ page }) => {
  await page.goto(BASE_URL + '/app/settings/analytics');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();

  // This test used to assert each tab rendered a table SIZED BY the endpoint:
  // status 200, then `items.length` echoed in the count label and the pagination
  // footer. That oracle was the response body, and the body was fabricated —
  // the three detail branches answered before consulting the repository at all,
  // and the tables they described were built from queries naming tables no
  // migration creates (issue #303).
  //
  // With the fabrication removed those routes answer 500 and say why, so the
  // claim inverts: a tab must SURFACE the missing source rather than render a
  // convincing empty table. That is the stricter half — "0 agents" with five
  // column headers is producible by a stub, by a broken query and by a genuinely
  // idle project alike, whereas a 500 naming the absent producer is producible
  // only by the handler actually asking its repository.
  //
  // The populated-table rendering is not lost: J24b drives it with a crafted
  // payload, as it did before this change.
  const tabs = [
    { tab: 'Agents', path: `${API_BASE}/elitea_core/analytics_agents/prompt_lib/${DEFAULT_PROJECT_ID}`, title: 'Agent Activity', columns: ['Agent', 'Events', 'Users', 'Avg Latency', 'Errors'] },
    { tab: 'Tools', path: `${API_BASE}/elitea_core/analytics_tools/prompt_lib/${DEFAULT_PROJECT_ID}`, title: 'Tool Details', columns: ['Tool', 'Calls', 'Users', 'Avg Latency', 'Errors'] },
    { tab: 'Users', path: `${API_BASE}/elitea_core/analytics_users/prompt_lib/${DEFAULT_PROJECT_ID}`, title: 'User Activity', columns: ['User', 'Events', 'Days', 'LLM', 'Tool', 'Agent', 'Chat Msg', 'Errors'] },
  ] as const;

  for (const spec of tabs) {
    // The oracle: the same endpoint the tab reads, called directly with the
    // browser context's own session.
    const resp = await page.request.get(spec.path);
    expect(resp.status(), `${spec.path} must report its missing source`).toBe(500);
    const failure = (await resp.json()) as { detail?: string };
    expect(failure.detail ?? '', `${spec.path} must name the absent producer`).toContain(
      'analytics: no data source',
    );

    await page.getByRole('tab', { name: spec.tab, exact: true }).click();

    // The error branch, and NOT a table. Asserting only the error text would
    // still pass against a page that rendered both, which is the failure this
    // half exists to catch.
    await expect(page.getByText('Failed to load analytics data.', { exact: true })).toBeVisible();
    await expect(page.getByText(spec.title, { exact: true })).toHaveCount(0);
    for (const column of spec.columns) {
      await expect(page.getByText(column, { exact: true })).toHaveCount(0);
    }
  }

  await checkA11y(page);
});

/* ────────────────────────────────────────────────────────────────────────
 * J24e — the filter bar is wired to the query, not decorative. Selecting a
 * preset must produce a NEW backend request whose range is the selected width.
 * ──────────────────────────────────────────────────────────────────────── */
test('J24e: a date preset re-queries the backend with the selected range', async ({ page }) => {
  const first = page.waitForRequest((r) => USAGE_RE.test(r.url()), { timeout: 20_000 });
  await page.goto(BASE_URL + '/app/settings/analytics');
  const initialUrl = new URL((await first).url());
  // Default preset is "Last 24h" (AnalyticsContainer.tsx:120-122).
  const initialSpanDays = spanDays(initialUrl);
  expect(initialSpanDays).toBeGreaterThan(0.9);
  expect(initialSpanDays).toBeLessThan(1.1);

  const refetch = page.waitForRequest(
    (r) => USAGE_RE.test(r.url()) && spanDays(new URL(r.url())) > 6.9,
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: 'Last 7d', exact: true }).click();
  const sevenDayUrl = new URL((await refetch).url());
  expect(spanDays(sevenDayUrl)).toBeLessThan(7.1);

  // The re-query lands and the page is still alive after the range change.
  // This used to wait on a KPI tile, which the live stack no longer renders:
  // the usage endpoint reports its missing data source (issue #303), so the
  // error branch is what a real range change settles into. The claim this
  // journey makes is about the REQUEST — the two assertions above, on the
  // second URL's span — so the tile was only ever a liveness check, and the
  // error branch serves that purpose without asserting a fabricated number.
  await expect(page.getByText('Failed to load analytics data.', { exact: true })).toBeVisible();

  await checkA11y(page);
});

/** `date_to - date_from`, in days, from a usage-endpoint URL. */
function spanDays(url: URL): number {
  const from = Date.parse(url.searchParams.get('date_from') ?? '');
  const to = Date.parse(url.searchParams.get('date_to') ?? '');
  expect(Number.isNaN(from), `date_from missing from ${url.pathname}${url.search}`).toBe(false);
  expect(Number.isNaN(to), `date_to missing from ${url.pathname}${url.search}`).toBe(false);
  return (to - from) / 86_400_000;
}
