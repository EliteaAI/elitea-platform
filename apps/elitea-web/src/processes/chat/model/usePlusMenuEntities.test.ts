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
      data: { id: 'pipe-7', description: 'Summarises the day', type: 'pipeline' },
    };

    expect(toPlusMenuItem(item, '42')).toEqual({
      id: 'pipe-7',
      name: 'Nightly digest',
      description: 'Summarises the day',
      participantType: 'pipeline',
      type: 'pipeline',
      project_id: '42',
    });
  });

  it('falls back to the label when the wire row carries no usable id', () => {
    const item = { label: 'Untitled', participantType: 'toolkit' as const, isPublic: false, data: { id: 99 } };

    // A numeric id is not the string the row shape promises, so it is not
    // passed off as one — the label is a stable, human-meaningful key.
    expect(toPlusMenuItem(item, undefined)).toEqual({ id: 'Untitled', name: 'Untitled', participantType: 'toolkit' });
  });
});
