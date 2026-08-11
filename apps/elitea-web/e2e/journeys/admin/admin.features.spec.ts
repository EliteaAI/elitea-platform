/**
 * Journey 35: A feature flag set on Admin › Features is a flag the platform
 *             actually obeys (JRNY-035)
 *
 * ## Why this journey needs to exist at all
 *
 * A feature flag that nothing reads is the purest form of the defect unit A14
 * exists to remove. It is worse than a missing feature and worse than an empty
 * table: the operator throws a platform-wide switch, is shown a success, and
 * believes the platform changed. Nothing about the page distinguishes that from
 * a switch that works — so every assertion here is against a SECOND surface,
 * reached after a full reload, that only a wired flag can change.
 *
 * Four of this page's six sections are live, and each is proved through its own
 * consumer:
 *
 *  - **MCP Configuration** → `GET /elitea_core/platform_settings/…` reports the
 *    flag, AND `POST /elitea_core/mcp_dcr_proxy/…` answers 403. The second is
 *    the half that cannot be faked in a client: the field's own description
 *    promises the switch "removes all MCP-related functionality … including API
 *    endpoints", and before this unit the three MCP routes never asked.
 *  - **Agent Publishing** → the publish endpoint refuses. Before this unit
 *    `Publish` validated the version name, the agent type and the publish status
 *    and never consulted the guardrail, so an operator blocking publishing
 *    during an incident would have been told it was blocked while every publish
 *    kept succeeding.
 *  - **Voice Features** → `GET /elitea_core/platform_settings/…` reports both
 *    flags, and `widgets/chat`'s `VoiceButton` — mounted on `/chat` through
 *    `ChatBox`'s slot bundle — reads them. It hardcoded both as module
 *    constants until this unit, so the admin switch named the control and could
 *    not change it.
 *  - **Help Center** (`resources`) → the round trip journey 34b used to own,
 *    moved here with the section. A link saved on this page is an anchor on
 *    `/help-center`, which is issue #26's end-to-end claim.
 *
 * The other two state a server-declared reason, and their endpoints refuse.
 *
 * ## Per-engine partitioning
 *
 * There is ONE platform configuration table and `fullyParallel` is on, so
 * chromium and webkit run this file concurrently against the same rows.
 * `describe.configure({ mode: 'serial' })` orders tests within a project and
 * does nothing across them.
 *
 * The Help Center test therefore owns a different resource CARD per engine, as
 * journey 34b did.
 *
 * The MCP and publishing tests cannot be partitioned that way: there is exactly
 * one `mcp_enabled` row and one guardrail for the whole platform, and their
 * whole point is that flipping it changes the platform. Two engines flipping the
 * same switch at once would have each engine observing the other's window —
 * `mcp_enabled` read back as `true` immediately after writing `false`, or a
 * publish that succeeded because the other engine had just restored the
 * guardrail. That is a test that fails for a reason unrelated to the product,
 * which is worse than no test: it teaches the next reader to re-run rather than
 * to look.
 *
 * So they take a cross-process MUTEX (`withPlatformFlagLock`). `mkdir` is the
 * primitive because it is atomic on every platform and needs no dependency — the
 * same reason lockfiles have used it for decades — and Playwright's own
 * `describe.serial` cannot help here, since it orders tests within a project and
 * does nothing across them.
 */
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test as adminTest, expect, type Page } from '@playwright/test';

import { checkA11y } from '../../fixtures/axe';
import { BASE_URL, STORAGE_STATE } from '../../../playwright.config';

adminTest.use({ storageState: STORAGE_STATE.admin });

adminTest.describe.configure({ mode: 'serial' });

/** The Help Center card this browser project owns. See the header. */
function ownedCard(projectName: string): {
  title: string;
  linksLabel: string;
  cardName: string;
  linksKey: string;
} {
  return projectName === 'chromium'
    ? {
        title: 'Documentation Card Title',
        linksLabel: 'Documentation Links',
        cardName: 'Documentation',
        linksKey: 'resources_documentation_links',
      }
    : {
        title: 'Tutorials Card Title',
        linksLabel: 'Tutorials Links',
        cardName: 'Tutorials',
        linksKey: 'resources_tutorials_links',
      };
}

function probeTitle(projectName: string): string {
  return `E2E ${projectName} handbook`;
}

function probeLink(projectName: string): { title: string; url: string } {
  return {
    title: `E2E ${projectName} link`,
    url: `https://docs.example.com/${projectName}`,
  };
}

async function openFeatures(page: Page): Promise<void> {
  const response = await page.goto(BASE_URL + '/admin/app/features', {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.status(), 'the admin SPA must serve the features route, not 404').toBeLessThan(
    400,
  );
  // MCP Configuration is the first available section, so it is what the page
  // opens on — and its presence proves the SCHEMA read was authorised.
  await expect(page.getByRole('switch', { name: 'Enable MCP' })).toBeVisible({
    timeout: 20_000,
  });
}

async function openSection(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(name) }).click();
}

/**
 * Serialises the tests that flip a platform-wide switch, across browser
 * projects as well as within one.
 *
 * `mkdir` on an existing directory fails atomically on every platform, which is
 * the whole mechanism. The lock is released in a `finally`, and a stale one from
 * a killed run is broken after `staleAfterMs` rather than deadlocking the suite
 * — a lock that can wedge CI is a worse failure than the race it prevents.
 */
async function withPlatformFlagLock<T>(run: () => Promise<T>): Promise<T> {
  const lockPath = join(tmpdir(), 'elitea-e2e-platform-flags.lock');
  const staleAfterMs = 90_000;
  const deadline = Date.now() + staleAfterMs;

  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch {
      if (Date.now() > deadline) {
        // Whoever held it is gone. Take it over rather than fail the run.
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  try {
    return await run();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

/** Writes one section through the product's own PUT, from the page's session. */
async function putValues(
  page: Page,
  section: string,
  values: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ([sectionId, payload]) => {
      const response = await fetch(
        `/api/v2/admin/plugin_config_values/administration/${String(sectionId)}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: payload }),
        },
      );
      return { status: response.status, body: await response.text() };
    },
    [section, values] as const,
  );
}

/* ── the page itself ───────────────────────────────────────────────────── */

adminTest(
  'J35: the page opens on a section this deployment can actually serve',
  async ({ page }) => {
    await openFeatures(page);

    await expect(page.getByText('Failed to load the feature sections.')).toHaveCount(0);
    // All six of the reference's sections are offered, live or not. Omitting the
    // unavailable ones would read as a page that lost features rather than a
    // platform that does not have them.
    for (const section of [
      'MCP Configuration',
      'Agent Publishing',
      'Skill Publishing',
      'Help Center',
      'Support Assistant',
      'Voice Features',
    ]) {
      await expect(page.getByRole('button', { name: new RegExp(section) })).toBeVisible();
    }
    // The unavailable ones are marked BEFORE they are opened.
    await expect(page.getByText('Not available here').first()).toBeVisible();

    await checkA11y(page);
  },
);

/* ── MCP: the switch, and the API it closes ────────────────────────────── */

adminTest(
  'J35b: switching MCP off is read by the platform AND closes the API',
  async ({ page }) => {
    await openFeatures(page);
    await withPlatformFlagLock(async () => {
      const settingsBefore = await page.evaluate(async () => {
        const response = await fetch('/api/v2/elitea_core/platform_settings/prompt_lib', {
          credentials: 'include',
        });
        return (await response.json()) as Record<string, unknown>;
      });
      expect(settingsBefore.mcp_enabled, 'the probe starts from MCP enabled').toBe(true);

      try {
        await page.getByRole('switch', { name: 'Enable MCP' }).click();
        const [saved] = await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().includes('/admin/plugin_config_values/administration/mcp_configuration') &&
              r.request().method() === 'PUT',
          ),
          page.getByRole('button', { name: 'Save' }).click(),
        ]);
        expect(saved.status(), 'the write must be authorised server-side').toBe(200);

        // A FULL RELOAD, not a cache read: the assertion a PUT that answers 200 and
        // writes nothing cannot pass.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.goto(BASE_URL + '/admin/app/features', {
          waitUntil: 'domcontentloaded',
        });
        await expect(page.getByRole('switch', { name: 'Enable MCP' })).not.toBeChecked();

        // …and the platform reads it. This is the flag apps/elitea-web's four
        // `useIsMcpVisible` hooks and its `/mcps` route gate on.
        const settings = await page.evaluate(async () => {
          const response = await fetch('/api/v2/elitea_core/platform_settings/prompt_lib', {
            credentials: 'include',
          });
          return (await response.json()) as Record<string, unknown>;
        });
        expect(settings.mcp_enabled, 'the product flag must follow the admin switch').toBe(false);
        expect(
          settings.mcp_in_menu_enabled,
          'MCP off implies out of the menu — a menu entry whose endpoints 403 is worse than none',
        ).toBe(false);

        // The half that cannot be done in a client. A switch that only hides
        // buttons leaves every one of these routes open to anyone with the URL,
        // while telling the operator they closed them.
        const proxied = await page.evaluate(async () => {
          const response = await fetch('/api/v2/elitea_core/mcp_dcr_proxy/1', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              registration_endpoint: 'https://example.invalid/register',
            }),
          });
          return { status: response.status, body: await response.text() };
        });
        expect(proxied.status, 'the MCP API must refuse while the master switch is off').toBe(403);
        expect(proxied.body).toContain('MCP exposure is disabled');
      } finally {
        // Restored inside the test, so a later failure cannot leave the stack
        // with MCP switched off for every other journey.
        const restored = await putValues(page, 'mcp_configuration', {
          mcp_enabled: true,
        });
        expect(restored.status).toBe(200);
      }
    });
  },
);

/* ── publishing: the guardrail ─────────────────────────────────────────── */

adminTest('J35c: blocking publishing is enforced by the publish endpoint', async ({ page }) => {
  await openFeatures(page);
  await openSection(page, 'Agent Publishing');
  await expect(page.getByRole('switch', { name: 'Block Agent Publishing' })).toBeVisible();

  await withPlatformFlagLock(async () => {
    try {
      const blocked = await putValues(page, 'agent_publishing', {
        is_publish_blocked: true,
        publish_whitelist_project_ids: [],
      });
      expect(blocked.status).toBe(200);

      // The publish route is asked for a version that may not exist; what matters
      // is that the answer is the GUARDRAIL's 403 and not a 404 about the version,
      // because the guardrail is checked before anything is looked up — a refusal
      // that arrives after validation leaks which version ids exist to a caller
      // the platform has just decided may not publish at all.
      const refused = await page.evaluate(async () => {
        const response = await fetch('/api/v2/elitea_core/publish/prompt_lib/1/99999', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version_name: 'e2e-probe' }),
        });
        return { status: response.status, body: await response.text() };
      });
      expect(refused.status, 'the publish guardrail must be enforced server-side').toBe(403);
      expect(refused.body).toContain('publishing is blocked');
    } finally {
      const restored = await putValues(page, 'agent_publishing', {
        is_publish_blocked: false,
      });
      expect(restored.status).toBe(200);
    }
  });
});

adminTest(
  'J35d: a field the server cannot honour is read-only and refuses its write',
  async ({ page }) => {
    await openFeatures(page);
    await openSection(page, 'Agent Publishing');

    // Rendered, read-only, with the server's own sentence — not hidden, which
    // would read as a page that lost a control, and not live, which would let a
    // save be attempted that the server refuses.
    const field = page.getByTestId('admin-config-field-unavailable-publish_validation_rules');
    await expect(field).toBeVisible();
    await expect(field.getByRole('textbox')).toBeDisabled();
    await expect(field).toContainText('no AI evaluator');

    // Forged, because the page offers no way to send it.
    const refused = await putValues(page, 'agent_publishing', {
      publish_validation_rules: 'reject anything mentioning production',
    });
    // 400, not 501: the SECTION is implemented. What is wrong is the field, and
    // the message names it.
    expect(refused.status).toBe(400);
    expect(refused.body).toContain('publish_validation_rules');

    // The sibling fields of the same section still save.
    const accepted = await putValues(page, 'agent_publishing', {
      is_publish_blocked: false,
    });
    expect(accepted.status).toBe(200);
  },
);

adminTest(
  'J35e: an array element of the wrong type is refused, not stored and ignored',
  async ({ page }) => {
    await openFeatures(page);

    // Both consumers type-assert their elements and SKIP what does not match, so
    // a wrongly-typed entry would be stored, echoed back by the GET, rendered in
    // the form — and do nothing. That is "saves into a void" one level down.
    const refusedCategory = await putValues(page, 'agent_publishing', {
      agent_categories: [{ name: 'Security Review' }],
    });
    expect(refusedCategory.status).toBe(400);
    expect(refusedCategory.body).toContain('agent_categories');

    const refusedProject = await putValues(page, 'agent_publishing', {
      publish_whitelist_project_ids: ['1'],
    });
    expect(refusedProject.status).toBe(400);
    expect(refusedProject.body).toContain('publish_whitelist_project_ids');
  },
);

adminTest(
  'J35f: the voice switches reach the platform settings the chat button reads',
  async ({ page }) => {
    await openFeatures(page);
    await openSection(page, 'Voice Features');
    await expect(page.getByRole('switch', { name: 'Voice Features Enabled' })).toBeVisible();

    const settings = async (): Promise<Record<string, unknown>> =>
      page.evaluate(async () => {
        const response = await fetch('/api/v2/elitea_core/platform_settings/prompt_lib', {
          credentials: 'include',
        });
        return (await response.json()) as Record<string, unknown>;
      });

    await withPlatformFlagLock(async () => {
      try {
        const [saved] = await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().includes('/admin/plugin_config_values/administration/voice_features') &&
              r.request().method() === 'PUT',
          ),
          (async () => {
            await page
              .getByRole('switch', { name: 'Disable Voice Controls but Keep Them Visible' })
              .click();
            await page.getByRole('button', { name: 'Save' }).click();
          })(),
        ]);
        expect(saved.status()).toBe(200);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await openFeatures(page);
        await openSection(page, 'Voice Features');
        await expect(
          page.getByRole('switch', { name: 'Disable Voice Controls but Keep Them Visible' }),
        ).toBeChecked();

        // The flag the product reads. `widgets/chat`'s VoiceButton renders it as
        // a visible-but-disabled control with an admin tooltip; before this unit
        // it read a module constant hardcoded to `false`.
        const after = await settings();
        expect(after.voice_features_temporarily_disabled).toBe(true);
        expect(
          after.voice_features_enabled,
          'temporarily disabling must not HIDE the control',
        ).toBe(true);
      } finally {
        const restored = await putValues(page, 'voice_features', {
          vite_voice_features_enabled: true,
          vite_voice_features_temporarily_disabled: false,
        });
        expect(restored.status).toBe(200);
      }
    });
  },
);

/* ── the Help Center round trip, moved here with its section ───────────── */

adminTest(
  'J35g: a Help Center link saved here survives a reload and reaches /help-center',
  async ({ page }, testInfo) => {
    await openFeatures(page);
    await openSection(page, 'Help Center');

    const card = ownedCard(testInfo.project.name);
    const link = probeLink(testInfo.project.name);

    const title = page.getByRole('textbox', { name: card.title });
    // The seed clears this card, so the baseline is the schema default. Starting
    // from "already set to the probe value" would prove nothing about the write.
    await expect(title).toHaveValue(card.cardName);
    await title.fill(probeTitle(testInfo.project.name));

    // Every link interaction is scoped to the OWNED card's editor: both engines
    // run this file at once against one platform-wide table, so `.last()` over
    // the page's link fields would sometimes be the other engine's row.
    const editor = page.getByTestId(`admin-config-links-${card.linksKey}`);
    await editor.getByRole('button', { name: `Add link — ${card.linksLabel}` }).click();
    await editor.getByRole('textbox', { name: 'URL' }).last().fill(link.url);
    await editor.getByRole('textbox', { name: 'Title', exact: true }).last().fill(link.title);

    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/admin/plugin_config_values/administration/resources') &&
          r.request().method() === 'PUT',
      ),
      page.getByRole('button', { name: 'Save' }).click(),
    ]);
    expect(saved.status(), 'the configuration write must be authorised server-side').toBe(200);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openFeatures(page);
    await openSection(page, 'Help Center');
    await expect(page.getByRole('textbox', { name: card.title })).toHaveValue(
      probeTitle(testInfo.project.name),
    );

    // …and the product reads it, from a page the section's move did not touch:
    // the Help Center calls the public `prompt_lib` route, which has no notion of
    // which admin page authored the row. This is issue #26's end-to-end claim,
    // and the proof that moving the section did not break it.
    await page.goto(BASE_URL + '/app/help-center', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('link', { name: link.title })).toHaveAttribute('href', link.url, {
      timeout: 20_000,
    });
  },
);

adminTest(
  'J35h: the server refuses a link URL that would run in a reader’s browser',
  async ({ page }, testInfo) => {
    await openFeatures(page);
    const card = ownedCard(testInfo.project.name);

    // Forged, not typed. The form warns about the scheme, so typing it would only
    // prove the form does — and a client-side check is not a boundary.
    const refused = await putValues(page, 'resources', {
      [card.linksKey]: [{ title: 'Docs', url: 'javascript:alert(document.cookie)' }],
    });
    expect(
      refused.status,
      'a link scheme that executes in every reader’s browser must be refused by the SERVER',
    ).toBe(400);
    expect(refused.body).toContain('http or https');

    // A caller that believes it set something the schema does not declare has a
    // wrong model of the system, and a 200 would confirm it.
    const unknown = await putValues(page, 'resources', {
      resources_backdoor: 'x',
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toContain('resources_backdoor');

    // And nothing was stored: the Help Center must not be carrying it.
    await page.goto(BASE_URL + '/app/help-center', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('link', { name: 'Docs' })).toHaveCount(0);
  },
);

/* ── the sections with no consumer ─────────────────────────────────────── */

adminTest(
  'J35i: a section with no consumer states its reason and refuses its write',
  async ({ page }) => {
    await openFeatures(page);

    for (const section of ['Skill Publishing', 'Support Assistant']) {
      await openSection(page, section);
      const notice = page.getByTestId('admin-features-unavailable');
      await expect(notice).toBeVisible();
      // The reason names the actual obstacle — a missing subsystem, or a widget
      // with no render site — so an operator can tell "this platform cannot do
      // that" from "that is switched off".
      await expect(notice).toContainText(
        /not implemented in this service|not mounted in this application/,
      );
      await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    }

    for (const section of ['skill_publishing', 'support_assistant']) {
      const refused = await putValues(page, section, { anything: true });
      expect(refused.status, `${section} must refuse its write, not accept and discard it`).toBe(
        501,
      );
    }

    await checkA11y(page);
  },
);

/* ── repeatability ─────────────────────────────────────────────────────── */

adminTest(
  'J35j: the probe values are restored so the run is repeatable',
  async ({ page }, testInfo) => {
    await openFeatures(page);
    await openSection(page, 'Help Center');
    const card = ownedCard(testInfo.project.name);

    await page.getByRole('textbox', { name: card.title }).fill(card.cardName);

    const editor = page.getByTestId(`admin-config-links-${card.linksKey}`);
    const remove = editor.getByRole('button', { name: /^Remove link/ });
    if ((await remove.count()) > 0) {
      await remove.last().click();
    }

    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/admin/plugin_config_values/administration/resources') &&
          r.request().method() === 'PUT',
      ),
      page.getByRole('button', { name: 'Save' }).click(),
    ]);
    expect(saved.status()).toBe(200);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openFeatures(page);
    await openSection(page, 'Help Center');
    await expect(page.getByRole('textbox', { name: card.title })).toHaveValue(card.cardName);
  },
);
