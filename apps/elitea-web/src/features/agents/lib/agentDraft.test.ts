import { describe, expect, it } from 'vitest';

import { EMPTY_AGENT_DRAFT, filterEmptyStrings, mapPredictResponseToAgentDraft } from './agentDraft';

describe('filterEmptyStrings', () => {
  it('drops blank and whitespace-only entries', () => {
    expect(filterEmptyStrings(['hello', '', '  ', 'world'])).toEqual(['hello', 'world']);
  });

  it('returns an empty array when every entry is blank', () => {
    expect(filterEmptyStrings(['', '   '])).toEqual([]);
  });

  it('returns a new array, not the input reference', () => {
    const input = ['a'];
    expect(filterEmptyStrings(input)).not.toBe(input);
  });
});

describe('mapPredictResponseToAgentDraft', () => {
  it('seeds instructions from content and leaves every other field at the empty default', () => {
    const draft = mapPredictResponseToAgentDraft('Draft agent instructions from the model.');
    expect(draft).toEqual({
      ...EMPTY_AGENT_DRAFT,
      instructions: 'Draft agent instructions from the model.',
    });
  });

  it('falls back to an empty string when content is undefined', () => {
    const draft = mapPredictResponseToAgentDraft(undefined);
    expect(draft.instructions).toBe('');
  });

  it('never fabricates suggested resources', () => {
    const draft = mapPredictResponseToAgentDraft('anything');
    expect(draft.suggested_toolkits).toEqual([]);
    expect(draft.suggested_mcp).toEqual([]);
    expect(draft.suggested_pipelines).toEqual([]);
    expect(draft.suggested_agents).toEqual([]);
    expect(draft.suggested_skills).toEqual([]);
  });
});
