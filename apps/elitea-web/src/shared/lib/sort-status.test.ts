import { describe, expect, it } from 'vitest';

import { CollectionStatus, MyLibraryStatusOptions, SortFields, SortOrderOptions } from './sort-status';

describe('sort/status enums', () => {
  it('SortOrderOptions / SortFields', () => {
    expect(SortOrderOptions).toEqual({ ASC: 'asc', DESC: 'desc' });
    expect(SortFields.CreatedAt).toBe('created_at');
    expect(SortFields.Authors).toBe('author');
  });

  it('CollectionStatus', () => {
    expect(CollectionStatus).toEqual({
      All: 'all',
      Draft: 'draft',
      Published: 'published',
      OnModeration: 'on_moderation',
      UserApproval: 'user_approval',
      Rejected: 'rejected',
    });
  });

  it('MyLibraryStatusOptions covers every CollectionStatus value with a label', () => {
    const values = MyLibraryStatusOptions.map((o) => o.value);
    expect(values).toEqual(Object.values(CollectionStatus));
    expect(MyLibraryStatusOptions.every((o) => typeof o.label === 'string' && o.label.length > 0)).toBe(true);
  });
});
