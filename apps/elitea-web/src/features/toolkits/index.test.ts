import { describe, expect, it } from 'vitest';

import * as slice from './index';

/**
 * Pins the slice's RUNTIME public surface (spec §3.3: index.ts is the only
 * file other slices may import). `export type` interfaces are erased by
 * `verbatimModuleSyntax` and never appear on the runtime namespace object,
 * so this list is deliberately the value-export subset only. Precedent:
 * `entities/application-form/index.test.ts`/`features/pipelines/index.test.ts`.
 *
 * This is A4e's ("Toolkits list/tab-bar UI + SharePoint OAuth sub-tree")
 * own first landing of this barrel — see `index.ts`'s own doc comment for
 * the shared-budget note. A sibling A4 sub-unit landing concurrently may
 * add more entries here; this test only pins THIS sub-unit's own
 * contribution and will need updating (not reverting) when that happens.
 */
const PUBLIC_SURFACE = ['ToolkitsList', 'ToolkitsTabBar', 'ToolkitsControls'] as const;

describe('features/toolkits public surface (A4e contribution)', () => {
  it('exports at least the documented runtime set from this sub-unit', () => {
    const exported = Object.keys(slice);
    for (const name of PUBLIC_SURFACE) {
      expect(exported).toContain(name);
    }
  });
});

/**
 * A4g's own contribution — `ToolkitEditor` MUST be exported here (see
 * `index.ts`'s own doc comment); `DeleteToolkitButton`/`ExportToolkitButton`
 * are exported alongside it, plus the four pieces `pages/toolkits/
 * CreateToolkit.tsx`/`EditToolkit.tsx` need as cross-slice entry points
 * (`ToolkitForm`/`ToolkitTypeSelector`/`CreateToolkitToolTabBar`/
 * `ConfigurationTab` — see `index.ts`'s own doc comment for the exact
 * budget accounting, 20/20).
 */
const A4G_PUBLIC_SURFACE = [
  'ToolkitEditor',
  'DeleteToolkitButton',
  'ExportToolkitButton',
  'ToolkitForm',
  'ToolkitTypeSelector',
  'CreateToolkitToolTabBar',
  'ConfigurationTab',
] as const;

describe('features/toolkits public surface (A4g contribution)', () => {
  it('exports at least the documented runtime set from this sub-unit', () => {
    const exported = Object.keys(slice);
    for (const name of A4G_PUBLIC_SURFACE) {
      expect(exported).toContain(name);
    }
  });

  it('does not exceed the §3.5 20-symbol budget across every A4x contribution', () => {
    // Value + type exports both count toward the budget (check-budgets.mjs
    // counts source-level export statements, not just the runtime
    // namespace) — this test only asserts the RUNTIME half stays sane as a
    // smoke check; the real budget gate is `scripts/check-budgets.mjs`.
    expect(Object.keys(slice).length).toBeLessThanOrEqual(20);
  });
});
