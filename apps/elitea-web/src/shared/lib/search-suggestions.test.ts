import { describe, expect, it } from 'vitest';

import { AutoSuggestionTitles, AutoSuggestionTypes } from './search-suggestions';

describe('search-autosuggest constants', () => {
  it('AutoSuggestionTypes', () => {
    expect(AutoSuggestionTypes).toEqual(['tag', 'application', 'pipeline', 'toolkit', 'skill']);
  });

  it('AutoSuggestionTitles', () => {
    expect(AutoSuggestionTitles.TOP).toBe('Top Search Requests');
    expect(AutoSuggestionTitles.MCPs).toBe('MCPs');
    expect(Object.keys(AutoSuggestionTitles)).toHaveLength(8);
  });
});
