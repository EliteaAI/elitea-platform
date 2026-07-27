import { describe, expect, it } from 'vitest';

import { GROUP_SELECT_VALUE_SEPARATOR, SearchParams, URL_PARAMS_KEY_TAGS } from './params';

describe('SearchParams', () => {
  it('preserves the exact query-param key strings', () => {
    expect(SearchParams.ViewMode).toBe('viewMode');
    expect(SearchParams.SortOrder).toBe('sort_order');
    expect(SearchParams.AuthorId).toBe('author_id');
    expect(SearchParams.CreateConversation).toBe('create');
    expect(SearchParams.EditedParticipantId).toBe('edited_participant_id');
    expect(SearchParams.IsMCP).toBe('mcp');
    expect(SearchParams.HistoryRunId).toBe('history_run_id');
    expect(SearchParams.SharedBucket).toBe('shared_bucket');
  });

  it('has exactly 27 keys (parity with constants.js:279-307)', () => {
    expect(Object.keys(SearchParams)).toHaveLength(27);
  });
});

describe('misc URL tokens', () => {
  it('URL_PARAMS_KEY_TAGS / GROUP_SELECT_VALUE_SEPARATOR', () => {
    expect(URL_PARAMS_KEY_TAGS).toBe('tags[]');
    expect(GROUP_SELECT_VALUE_SEPARATOR).toBe('::::');
  });
});
