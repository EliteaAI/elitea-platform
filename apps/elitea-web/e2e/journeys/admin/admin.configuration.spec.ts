/**
 * Journey 34: Admin › Configuration states what it cannot configure (JRNY-034)
 *
 * ## What this journey is now, and why it changed
 *
 * It used to be "a platform setting saved here is the setting the product
 * reads", over the `resources` section. Unit A14's **Features** page took that
 * section — the reference puts it there (`ConfigurationPage.jsx` subtracts it
 * via `MOVED_TO_FEATURES`; `FeaturesPage.jsx` renders it as "Help Center"), and
 * #217 recorded that it had parked the section here only because the server's
 * schema had it and because leaving it out would have kept #26 open for another
 * unit. The round trip it proved now lives in journey 35 (`admin.features.spec.ts`),
 * unchanged in substance and asserted against the same public route.
 *
 * Most of what is left on this page is every section this platform cannot serve
 * HERE — Pylon plugin configuration, and a maintenance hook that does not
 * exist. That is a true and useful thing for the page to say, and it is most of
 * what this journey asserts: not that a form renders, but that each pane states
 * a server-declared REASON and each endpoint refuses the write rather than
 * accepting and discarding it.
 *
 * **Guardrails is the exception, and is now the page's landing section.** It was
 * on the unavailable list until the toolkit surfaces, the toolkit write paths
 * and the agent tool freeze started reading `toolkit_security.*`. So this
 * journey no longer says "everything here is unavailable"; it says which
 * sections are, which one is not, and — because the difference is the whole
 * point of the page — that the two look different.
 *
 * **LLM Governance is unavailable for a CHANGED REASON, not a changed status.**
 * It used to be withheld because nothing enforced it. #218 made the gateway
 * read and enforce `gateway.governance_config`, so the section now points at
 * `/admin/app/governance` and says the definitions take effect. It stays
 * unavailable HERE because a governance corpus is a list of scoped rows and
 * this page is a flat form over one value document.
 *
 * Before unit A14 every one of those sections answered 200 on both verbs — the
 * GET with schema defaults, the PUT with an empty object and the request body
 * never read. A journey asserting "a configuration form is present and saving
 * shows a toast" would have passed against all of it.
 */
import { test as adminTest, expect, type Page } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

adminTest.describe.configure({ mode: 'serial' });

async function openConfiguration(page: Page): Promise<void> {
  const response = await page.goto(BASE_URL + '/admin/app/configuration', {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.status(), 'the admin SPA must serve the configuration route, not 404').toBeLessThan(400);
  // The sidebar rendering at all proves the SCHEMA read was authorised; an
  // empty one would mean the read is unwired, which reads identically to a
  // deployment with no sections.
  await expect(page.getByRole('button', { name: /Guardrails/ })).toBeVisible({ timeout: 20_000 });
}

adminTest('J34: the sidebar marks what this deployment cannot configure', async ({ page }) => {
  await openConfiguration(page);

  await expect(page.getByText('Failed to load the configuration sections.')).toHaveCount(0);

  // Marked in the SIDEBAR, so the shape of what this deployment offers is
  // legible before the operator clicks anything.
  const marks = page.getByText('Not available here');
  await expect(marks.first()).toBeVisible();
  expect(await marks.count(), 'most Configuration sections remain unavailable').toBeGreaterThan(5);

  // Guardrails is NOT among them, and is the section the page lands on. The
  // count above cannot show that on its own: it would still pass if every
  // section were unavailable, which is what it asserted before guardrails had
  // consumers.
  const guardrails = page.getByRole('button', { name: /Guardrails/ });
  await expect(guardrails).toBeVisible();
  await expect(guardrails.getByText('Not available here')).toHaveCount(0);

  // MCP Servers is the OTHER exception, for a different reason, and the
  // difference is worth keeping visible: Guardrails dropped its
  // `unavailable_reason` outright, while MCP Servers still declares one — true
  // of the plugin-config value endpoints, which cannot serve a catalogue that
  // carries a client secret — and is editable anyway because it also declares
  // a `managed_surface`. Marking it would send an operator away from the only
  // page that can edit it.
  const mcpServers = page.getByRole('button', { name: /MCP Servers/ });
  await expect(mcpServers).toBeVisible();
  await expect(mcpServers.getByText('Not available here')).toHaveCount(0);

  // Authentication is the third exception, and the same shape as MCP Servers:
  // it keeps its `unavailable_reason` — true of the plugin-config value
  // endpoints, which cannot hold an OIDC client secret — and declares a
  // `managed_surface` that this build renders.
  const authentication = page.getByRole('button', { name: /Authentication/ });
  await expect(authentication).toBeVisible();
  await expect(authentication.getByText('Not available here')).toHaveCount(0);

  await checkA11y(page);
});

adminTest('J34a: Guardrails offers a real form, including its two tool maps', async ({ page }) => {
  await openConfiguration(page);
  await page.getByRole('button', { name: /Guardrails/ }).click();

  // A save control exists here and nowhere else on this page — the difference
  // between a section with a backend and a section without one.
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(page.getByTestId('admin-configuration-unavailable')).toHaveCount(0);

  // The two map fields render as EDITORS, not as the "no editor for this field
  // yet" row. Guardrails is order 1, so this is the first screen of the page,
  // and `blocked_tools`/`sensitive_tools` are the substance of the feature —
  // shipping them inert would have made the landing screen a form whose two
  // most important controls do nothing.
  // Named per field: two identically-labelled buttons on one screen would be
  // ambiguous to a screen reader and to this assertion alike.
  await expect(page.getByRole('button', { name: 'Add toolkit — Blocked Tools' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add toolkit — Sensitive Action Tools' })).toBeVisible();
  await expect(
    page.getByText('This platform has no editor for this field yet', { exact: false }),
  ).toHaveCount(0);

  await checkA11y(page);
});

adminTest('J34b: the sections with no backend say so instead of showing a form', async ({ page }) => {
  await openConfiguration(page);

  // Guardrails left this list when it gained consumers — see J34a;
  // Authentication left it when it gained a typed store and a login path that
  // reads it — see J34f; and LiteLLM left it by ceasing to exist, replaced by
  // the managed LLM Proxy section — see J34g.
  //
  // Runtime replaces LiteLLM here. It has to be a section that is STILL
  // unavailable, or this journey asserts a refusal that no longer happens and
  // would pass only by never reaching the click.
  for (const section of ['Runtime', 'Maintenance', 'Advanced']) {
    await page.getByRole('button', { name: new RegExp(section) }).click();
    const notice = page.getByTestId('admin-configuration-unavailable');
    await expect(notice).toBeVisible();
    // The reason names the system, so an operator can tell "this platform
    // cannot configure that" from "that is configured to its defaults". A form
    // over defaults would say the second when the truth is the first.
    await expect(notice).toContainText(/Pylon|gateway|page of their own/);
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  }

  await checkA11y(page);
});

adminTest('J34c: an unavailable section refuses its write rather than discarding it', async ({ page }) => {
  await openConfiguration(page);

  // Forged: the page offers no control at all for this section, which is the
  // point — the refusal must be the SERVER's, not the absence of a button.
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/v2/admin/plugin_config_values/administration/auth', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { oidc_client_secret: 'hunter2' } }),
    });
    return response.status;
  });
  expect(status, 'an unavailable section must refuse its write, not accept and discard it').toBe(501);
});

adminTest('J34f: the Authentication section renders its editor, not a refusal', async ({ page }) => {
  await openConfiguration(page);

  await page.getByRole('button', { name: /Authentication/ }).click();

  // The editor's own control, so this proves the dedicated surface MOUNTED —
  // not merely that the refusal notice is absent, which a blank pane would also
  // satisfy.
  await expect(page.getByTestId('admin-identity-providers-add')).toBeVisible();
  await expect(page.getByTestId('admin-configuration-unavailable')).toHaveCount(0);

  // The provider read is authorised and answered. This stack federates its
  // logins through the environment rather than an authored row, so the empty
  // state is the truthful branch here; the error alert would mean the route
  // refused, which is what this asserts is NOT happening.
  await expect(page.getByTestId('admin-identity-providers-empty')).toBeVisible();
  await expect(page.getByTestId('admin-identity-providers-error')).toHaveCount(0);

  // SCIM group provisioning renders in the SAME section: a provider federates
  // the login and SCIM pushes the directory, and one of the two is not
  // configuration an operator finds on another screen.
  //
  // Its own read is authorised and answered too. The empty state is the
  // truthful branch on this stack — no group is bound — and the error alert
  // would mean the route refused, which is what this asserts is NOT happening.
  await expect(page.getByTestId('admin-scim-group-bindings-add')).toBeVisible();
  await expect(page.getByTestId('admin-scim-group-bindings-empty')).toBeVisible();
  await expect(page.getByTestId('admin-scim-group-bindings-error')).toHaveCount(0);

  await checkA11y(page);
});

adminTest('J34d: the sections the Features page owns are not offered here', async ({ page }) => {
  await openConfiguration(page);

  // One section editable from two pages would be two drafts of one row, and the
  // two pages would disagree about whether it is dirty. The partition is
  // server-declared (`page: "features"`); this asserts the client honours it.
  for (const moved of ['Help Center', 'MCP Configuration', 'Agent Publishing', 'Voice Features']) {
    await expect(page.getByRole('button', { name: new RegExp(moved) })).toHaveCount(0);
  }
});

adminTest('J34e: the MCP Servers section renders its editor, not a refusal', async ({ page }) => {
  await openConfiguration(page);

  await page.getByRole('button', { name: /MCP Servers/ }).click();

  // The editor's own control, so this proves the dedicated surface MOUNTED —
  // not merely that the refusal notice is absent, which a blank pane would also
  // satisfy.
  await expect(page.getByTestId('admin-mcp-servers-add')).toBeVisible();
  await expect(page.getByTestId('admin-configuration-unavailable')).toHaveCount(0);

  // The catalogue read is authorised and answered. A fresh deployment catalogues
  // nothing, so the empty state is the truthful branch here; the error alert
  // would mean the route refused, which is what this asserts is NOT happening.
  await expect(page.getByTestId('admin-mcp-servers-empty')).toBeVisible();
  await expect(page.getByTestId('admin-mcp-servers-error')).toHaveCount(0);

  await checkA11y(page);
});

adminTest('J34g: the LLM Proxy section renders its editor, not a refusal', async ({ page }) => {
  await openConfiguration(page);

  // The section that replaced LiteLLM. LiteLLM is gone — ADR-0015 replaced it
  // with the Bifrost-based elitea-llm-gateway — so the old name must not be on
  // this page at all: an operator who finds it would look for controls over a
  // subsystem that no longer exists.
  await expect(page.getByRole('button', { name: /LiteLLM/ })).toHaveCount(0);

  const llmProxy = page.getByRole('button', { name: /LLM Proxy/ });
  await expect(llmProxy).toBeVisible();
  // Editable despite still declaring an `unavailable_reason` — true of the
  // plugin-config value endpoints, which cannot serve a live status report or a
  // price catalogue — because it also declares a `managed_surface`. Marking it
  // would send an operator away from the only page that can edit it.
  await expect(llmProxy.getByText('Not available here')).toHaveCount(0);

  await llmProxy.click();

  // The editor's own control, so this proves the dedicated surface MOUNTED —
  // not merely that the refusal notice is absent, which a blank pane would also
  // satisfy.
  await expect(page.getByTestId('llm-proxy-tabs')).toBeVisible();
  await expect(page.getByTestId('admin-configuration-unavailable')).toHaveCount(0);

  // The status panel reaches the gateway through elitea-main. On a stack with no
  // gateway wired it reports that as a state rather than as a load failure, so
  // either the loaded snapshot or the explained unreachable notice is correct
  // here — what must NOT happen is the panel failing to read its own route.
  await expect(page.getByTestId('llm-proxy-status-error')).toHaveCount(0);

  await checkA11y(page);
});

adminTest('J34h: the LLM Proxy model catalogue is authorised and answers', async ({ page }) => {
  await openConfiguration(page);
  await page.getByRole('button', { name: /LLM Proxy/ }).click();
  await page.getByRole('tab', { name: 'Models & pricing' }).click();

  // Wait for a POSITIVE terminal state before judging. `llm-proxy-add-price`
  // renders unconditionally and the error test-ids are absent while the request
  // is still in flight, so asserting only those would pass against a route that
  // 403s or 500s a moment later — absence read as success.
  //
  // A fresh deployment has not run a price sync, so the empty state is the
  // truthful branch; a stack with a catalogue shows the table. Either proves the
  // read completed.
  await expect(
    page.getByTestId('llm-proxy-models-empty').or(page.getByTestId('llm-proxy-models-table')),
  ).toBeVisible();
  await expect(page.getByTestId('llm-proxy-add-price')).toBeVisible();
  await expect(page.getByTestId('llm-proxy-models-load-error')).toHaveCount(0);
  await expect(page.getByTestId('llm-proxy-models-error')).toHaveCount(0);

  await checkA11y(page);
});
