import { describe, expect, it } from 'vitest';

import { useCredentialWarningModal } from './model/useCredentialWarningModal';
import { CredentialWarningBanner } from './ui/CredentialWarningBanner';
import { CredentialWarningModal } from './ui/CredentialWarningModal';

import * as slice from './index';

/**
 * Pins the slice's RUNTIME public surface (spec §3.3: index.ts is the only
 * file other slices may import). `export type` interfaces are erased by
 * `verbatimModuleSyntax` and never appear on the runtime namespace object,
 * so this list is deliberately the value-export subset only. Precedent:
 * `features/toolkits/index.test.ts`.
 *
 * A7-api-model adversarial-review regression test (consolidating an A7-ui
 * pass through the same file): `useCredentialWarningModal` (plus the
 * `lib/credentialWarning.ts` pure helpers it wraps, and the sibling
 * `CredentialWarningModal`/`CredentialWarningBanner` UI it was built for)
 * were fully built and tested but not reachable from `index.ts` at all
 * (finding: "not exported ... and has zero live importers anywhere in the
 * app"). A first pass added `CredentialWarningModal`/
 * `useCredentialWarningModal` as two flat exports, which is what this test
 * originally pinned — but a third flat export for
 * `CredentialWarningBanner` would have breached the §3.5 20-export budget,
 * so this pass grouped all three into one `CredentialWarning` export
 * instead (see `index.ts`'s own doc comment for the full rationale). This
 * test would have caught either regression — the original "not exported at
 * all" state, and a re-ungrouping that silently drops one of the three off
 * the object again.
 */
const PUBLIC_SURFACE = [
  'useAvailableConfigurationsType',
  'useConfigurationDetail',
  'useConfigurationsList',
  'useCreateConfiguration',
  'useDeleteConfiguration',
  'useTestConfigurationConnection',
  'useUpdateConfiguration',
  'classifySchemaField',
  'initialDataForSchema',
  'extractInformationFromCredentialError',
  'generateCredentialTagList',
  'normalizeCredentialPage',
  'useCredentialValidation',
  'CredentialsControls',
  'CredentialsSelect',
  'CredentialsTabBar',
  'CredentialWarning',
] as const;

describe('features/credentials public surface (A7-api-model)', () => {
  it('exports the full documented runtime set', () => {
    const exported = Object.keys(slice);
    for (const name of PUBLIC_SURFACE) {
      expect(exported).toContain(name);
    }
  });

  it('does not exceed the §3.5 20-symbol budget on the runtime half of the surface', () => {
    // Value + type exports both count toward the real budget gate
    // (scripts/check-budgets.mjs counts source-level export statements, not
    // just the runtime namespace) — this test only sanity-checks the
    // RUNTIME half; the real gate is `node scripts/check-budgets.mjs`.
    expect(Object.keys(slice).length).toBeLessThanOrEqual(20);
  });

  it('groups the credential-change-warning hook, modal, and banner under CredentialWarning, wired to their real implementations', () => {
    expect(slice.CredentialWarning.useModal).toBe(useCredentialWarningModal);
    expect(slice.CredentialWarning.Modal).toBe(CredentialWarningModal);
    expect(slice.CredentialWarning.Banner).toBe(CredentialWarningBanner);
  });
});
