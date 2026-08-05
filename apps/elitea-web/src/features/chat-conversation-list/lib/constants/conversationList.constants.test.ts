import { describe, expect, it } from 'vitest';

import { DATE_GROUP_DISPLAY_NAMES } from './conversationList.constants';

describe('DATE_GROUP_DISPLAY_NAMES', () => {
  it('maps every date-group key to its display label, matching the old app 1:1', () => {
    expect(DATE_GROUP_DISPLAY_NAMES).toEqual({
      today: 'Today',
      this_week: 'This Week',
      older: 'Older',
    });
  });
});
