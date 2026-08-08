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
test('J24: settings: analytics overview renders the KPI values the backend returned', async ({ page }) => {
  const usage = page.waitForResponse(
    (r) => USAGE_RE.test(r.url()) && r.request().method() === 'GET' && r.status() === 200,
    { timeout: 20_000 },
  );

  await page.goto(BASE_URL + '/app/settings/analytics');
  const payload = (await (await usage).json()) as { kpis: Kpis; models: unknown[] };

  // Chrome that only the real container renders (AnalyticsContainer.tsx:159-236).
  // 15s, not the 5s default: `projectName` reaches the header only after
  // `useSelectedProject`'s hydration effect pushes the persisted selection into
  // the store (widgets/app-shell/model/useSelectedProject.hooks.ts:22-29), which
  // is a mount-order race against the route component on a loaded stack.
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

  // The acceptance clause itself: dashboard values, derived from the response.
  await expectKpiRow(page, payload.kpis);

  await expect(page.getByText('Daily Activity', { exact: true })).toBeVisible();
  await expect(page.getByText('Top 5 AI Adopters', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Leaderboard by AI events (LLM + Tool + Agent)', { exact: true }),
  ).toBeVisible();
  // recharts mounts a real <svg class="recharts-surface"> for the Daily
  // Activity area chart — present whether or not the series has points.
  await expect(page.locator('.recharts-surface')).toHaveCount(1);
  // `ModelUsageTable` returns null for an empty `models` array
  // (ModelUsageTable.tsx:102), so its presence is a function of the payload.
  await expect(page.getByText('Model Usage Breakdown', { exact: true })).toHaveCount(
    payload.models.length === 0 ? 0 : 1,
  );

  await checkA11y(page);
});

/* ────────────────────────────────────────────────────────────────────────
 * The live backend's `Usage()` handler returns an all-zero `kpis` and empty
 * `top_ai_users`/`daily_activity`/`models`
 * (`internal/api/v2/analytics/handler.go:37-64` hardcodes every field except
 * `llm_calls`/`agent_runs`/`total_tokens`/`total_cost`, and `usage_records`
 * is empty in the E2E stack). So the populated-dashboard branches — the
 * leaderboard rows, the `fmtNum` K/M abbreviation, the adoption badge, the
 * model table — are unreachable against real data today.
 *
 * They are reached here by serving one crafted response for the ONE usage
 * endpoint, which is also what proves the tiles are bound to the payload
 * rather than rendering hardcoded zeros: J24 above cannot tell those two
 * apart while every real value is 0.
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
test('J24d: the Agents/Tools/Users tabs render tables sized by the backend', async ({ page }) => {
  await page.goto(BASE_URL + '/app/settings/analytics');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();

  const tabs = [
    {
      tab: 'Agents',
      path: `${API_BASE}/elitea_core/analytics_agents/prompt_lib/${DEFAULT_PROJECT_ID}`,
      title: 'Agent Activity',
      noun: 'agents',
      columns: ['Agent', 'Events', 'Users', 'Avg Latency', 'Errors'],
      search: 'Search by agent name',
    },
    {
      tab: 'Tools',
      path: `${API_BASE}/elitea_core/analytics_tools/prompt_lib/${DEFAULT_PROJECT_ID}`,
      title: 'Tool Details',
      noun: 'tools',
      columns: ['Tool', 'Calls', 'Users', 'Avg Latency', 'Errors'],
      search: 'Search by tool name',
    },
    {
      tab: 'Users',
      path: `${API_BASE}/elitea_core/analytics_users/prompt_lib/${DEFAULT_PROJECT_ID}`,
      title: 'User Activity',
      noun: 'users',
      columns: ['User', 'Events', 'Days', 'LLM', 'Tool', 'Agent', 'Chat Msg', 'Errors'],
      search: 'Search by email',
    },
  ] as const;

  for (const spec of tabs) {
    // The oracle: the same endpoint the tab reads, called directly with the
    // browser context's own session.
    const resp = await page.request.get(spec.path);
    expect(resp.status(), `${spec.path} must be a registered route`).toBe(200);
    const items = ((await resp.json()) as { items: unknown[] }).items;
    expect(Array.isArray(items), `${spec.path} must return an items array`).toBe(true);

    await page.getByRole('tab', { name: spec.tab, exact: true }).click();

    const title = page.getByText(spec.title, { exact: true });
    await expect(title).toBeVisible();
    // The card Box wrapping title + subtitle + PaginatedEntityTable. Scoped
    // deliberately: bare `getByText('Users')` also matches the "Users" TAB and
    // the settings-sidebar link, so an unscoped column assertion would pass
    // against a page that renders no table at all.
    const card = title.locator('..');
    // "{{count}} agents|tools|users" — the count the component derives from
    // `data.items.length` must equal what the endpoint just returned.
    await expect(card.getByText(`${items.length} ${spec.noun}`, { exact: true })).toBeVisible();
    for (const column of spec.columns) {
      await expect(card.getByText(column, { exact: true })).toBeVisible();
    }
    await expect(card.getByPlaceholder(spec.search)).toBeVisible();
    // MUI TablePagination's count label, driven by the same array.
    await expect(
      card.getByText(items.length === 0 ? '0–0 of 0' : `1–${Math.min(20, items.length)} of ${items.length}`, {
        exact: true,
      }),
    ).toBeVisible();
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

  // The re-query lands: the tiles are still rendered after the range change.
  await expect(kpi(page, 'LLM CALLS')).toBeVisible();

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
