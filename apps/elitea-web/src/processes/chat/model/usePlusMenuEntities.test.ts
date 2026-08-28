/**
 * The flattening the "+" menu's rows depend on.
 *
 * `PlusChatButton`'s `toEntityItems` reads `item.id` / `item.name`, while
 * `useChatEntityBrowser` returns `{label, participantType, isPublic, data}`
 * with the real id one level down. Handing those through unchanged is not a
 * crash — it is a menu where every row reads "Pipeline 1", "Pipeline 2", …
 * and the select handler receives a wrapper object. That is exactly the kind
 * of defect a render test of either side passes straight through, so it is
 * pinned here at the seam.
 */
import { describe, expect, it } from 'vitest';

import { toPlusMenuItem } from './usePlusMenuEntities';

describe('toPlusMenuItem', () => {
  it('lifts the label and the wire id out of the candidate wrapper', () => {
    const item = {
      label: 'Nightly digest',
      participantType: 'pipeline' as const,
      isPublic: false,
      data: { id: 'pipe-7', description: 'Summarises the day', type: 'pipeline', version_details: { id: 'v3' } },
    };

    expect(toPlusMenuItem(item, '42', { pipeline: true })).toEqual({
      id: 'pipe-7',
      name: 'Nightly digest',
      description: 'Summarises the day',
      participantType: 'pipeline',
      type: 'pipeline',
      version_details: { id: 'v3' },
      project_id: '42',
      agent_type: 'pipeline',
    });
  });

  it('normalises numeric ids and preserves the row project', () => {
    const item = { label: 'Untitled', participantType: 'toolkit' as const, isPublic: false, data: { id: 99 } };

    expect(toPlusMenuItem(item, undefined)).toEqual({ id: '99', name: 'Untitled', participantType: 'toolkit' });
  });

  it('marks MCP rows without discarding existing metadata', () => {
    const item = {
      label: 'MCP',
      participantType: 'toolkit' as const,
      isPublic: false,
      data: { id: '7', project_id: 9, meta: { source: 'catalog' } },
    };

    expect(toPlusMenuItem(item, '42', { mcp: true })).toMatchObject({
      id: '7',
      project_id: '9',
      meta: { source: 'catalog', mcp: true },
    });
  });
});
