import { describe, expect, it } from 'vitest';

import * as entity from './index';

/**
 * Pins the slice's RUNTIME public surface (spec §3.3: index.ts is the only
 * file other slices may import). `export type` interfaces are erased by
 * `verbatimModuleSyntax` and never appear on the runtime namespace object,
 * so this list is deliberately the value-export subset only — see the
 * source files for the full (type + value) surface. Precedent:
 * src/shared/brand/index.test.ts. Also gives knip a live import edge into
 * this slice ahead of its Wave-2 consumers.
 */
const PUBLIC_SURFACE = [
  'DATE_GROUP_ORDER',
  'DEFAULT_EXPANDED_GROUP',
  'DEFAULT_FOLDER_NAME',
  'conversationMatchId',
  'flattenGroupedConversations',
  'isPinnedFolder',
  'resolveInitialExpandedGroup',
  'sortFoldersByName',
  'visibleDateGroups',
] as const;

describe('entities/folder public surface', () => {
  it('exports exactly the documented runtime set', () => {
    expect(Object.keys(entity).sort()).toEqual([...PUBLIC_SURFACE].sort());
  });
});
