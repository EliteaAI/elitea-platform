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
    // MUI Select dropdowns render their listbox in a portal at document root;
    // the `combobox` role rule fires a false positive when the portal is detached.
    .disableRules(['aria-required-children'])
    .analyze();

  expect(results.violations).toEqual([]);
}
