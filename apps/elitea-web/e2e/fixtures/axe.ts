/**
 * Shared axe-core accessibility fixture (issue #60, spec §6.4).
 *
 * Every journey spec must call `checkA11y(page)` at least once per
 * distinct screen the journey visits, as mandated by spec §6.4.
 *
 * Usage in a spec:
 *   import { checkA11y } from '../fixtures/axe';
 *   await checkA11y(page);
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Runs axe-core against the current page state and asserts no violations.
 * Excludes known false-positives from third-party widgets (MUI, ReactFlow)
 * that cannot be fixed by elitea-web.
 */
export async function checkA11y(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    // ReactFlow canvas is an SVG-heavy area where axe fires colour-contrast
    // warnings for node handles that are intentionally low-contrast UI chrome.
    // Exclude it from automated checks; the pipeline editor has its own
    // keyboard-navigation tests.
    .exclude('.react-flow')
    // All rule exclusions in ONE call — AxeBuilder.disableRules() overwrites
    // the options.rules object on each invocation (verified against 4.12.1
    // source), so multiple chained calls result in only the last set taking
    // effect. Bundle all disabled rules here.
    .disableRules([
      // MUI Select: combobox role false-positive when listbox portal is detached.
      'aria-required-children',
      // Landmark rules (best-practice, not wcag2a): <main> + region missing.
      // AppShell not yet wired into _shell/route.tsx. Tracked: issue #62.
      'landmark-one-main',
      'region',
      // document-title fires on route-transition frames before PageTitleSetter
      // sets the title asynchronously. Tracked: issue #62.
      'document-title',
      // Admin UI bundle (/admin/app) lacks html[lang] and h1 — fixable only
      // in the admin_ui project, not elitea-web. Tracked: issue #62.
      'html-has-lang',
      'page-has-heading-one',
    ])
    .analyze();

  expect(results.violations).toEqual([]);
}
