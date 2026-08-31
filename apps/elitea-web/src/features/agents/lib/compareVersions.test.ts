import { describe, expect, it } from 'vitest';

import type { ApplicationVersionDetail } from '@/shared/api/generated/model';

import { extractAgentCompareData, matchDependencies, sortVersionsNewestFirst } from './compareVersions';

describe('extractAgentCompareData', () => {
  it('defaults every field, so an absent version renders empty panes rather than throwing', () => {
    expect(extractAgentCompareData(undefined)).toEqual({
      instructions: '',
      welcomeMessage: '',
      conversationStarters: [],
      tools: [],
    });
  });

  it('reads the four compared fields off a version detail', () => {
    const detail = {
      instructions: 'be brief',
      welcome_message: 'hi',
      conversation_starters: ['a', 'b'],
      tools: [{ id: 4, name: 'jira', type: 'toolkit' }],
    } as unknown as ApplicationVersionDetail;
    const data = extractAgentCompareData(detail);
    expect(data.instructions).toBe('be brief');
    expect(data.welcomeMessage).toBe('hi');
    expect(data.conversationStarters).toEqual(['a', 'b']);
    expect(data.tools).toEqual([{ id: '4', name: 'jira', entityType: 'toolkit' }]);
  });

  /**
   * The baseline's `resolveToolId`: an application tool is identified by the
   * APPLICATION it points at. Matching on the tool row id instead would
   * report the same agent as "only in this version" whenever the two
   * versions attached it through different rows.
   */
  it('identifies an application tool by settings.application_id, not the row id', () => {
    const detail = {
      tools: [{ id: 99, name: 'helper', type: 'application', settings: { application_id: 12 } }],
    } as unknown as ApplicationVersionDetail;
    expect(extractAgentCompareData(detail).tools[0]).toEqual({ id: '12', name: 'helper', entityType: 'agent' });
  });

  it('marks an application tool with agent_type=pipeline as a pipeline, and falls back to toolkit otherwise', () => {
    const detail = {
      tools: [
        { id: 1, name: 'flow', type: 'application', agent_type: 'pipeline', settings: { application_id: 3 } },
        { id: 2, name: 'skill', type: 'skill', entity_type: 'skill' },
        { id: 3, name: 'mystery' },
      ],
    } as unknown as ApplicationVersionDetail;
    expect(extractAgentCompareData(detail).tools.map((tool) => tool.entityType)).toEqual(['pipeline', 'skill', 'toolkit']);
  });
});

describe('matchDependencies', () => {
  const left = [{ id: '1', name: 'jira', entityType: 'toolkit' }, { id: '2', name: 'only-left', entityType: 'toolkit' }];
  const right = [{ id: '1', name: 'jira', entityType: 'toolkit' }, { id: '3', name: 'only-right', entityType: 'toolkit' }];

  it('pairs shared dependencies and leaves one side null for the unique ones', () => {
    const rows = matchDependencies(left, right);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ key: 'toolkit:1' });
    expect(rows[0]?.left?.name).toBe('jira');
    expect(rows[0]?.right?.name).toBe('jira');
    expect(rows[1]?.right).toBeNull();
    expect(rows[2]?.left).toBeNull();
  });

  it('keys on entityType too — the same id under two types is two dependencies', () => {
    const rows = matchDependencies([{ id: '1', name: 'a', entityType: 'toolkit' }], [{ id: '1', name: 'b', entityType: 'skill' }]);
    expect(rows.map((row) => row.key)).toEqual(['toolkit:1', 'skill:1']);
  });

  it('returns nothing when neither version attaches anything', () => {
    expect(matchDependencies([], [])).toEqual([]);
  });
});

describe('sortVersionsNewestFirst', () => {
  it('orders by created_at, newest first', () => {
    const sorted = sortVersionsNewestFirst([
      { id: 1, created_at: '2026-01-01T00:00:00Z' },
      { id: 2, created_at: '2026-03-01T00:00:00Z' },
      { id: 3, created_at: '2026-02-01T00:00:00Z' },
    ]);
    expect(sorted.map((version) => version.id)).toEqual([2, 3, 1]);
  });

  /** An unparseable date must not poison the comparator with NaN. */
  it('sorts versions with no usable timestamp last', () => {
    const sorted = sortVersionsNewestFirst([
      { id: 1 },
      { id: 2, created_at: '2026-01-01T00:00:00Z' },
      { id: 3, created_at: 'not a date' },
    ]);
    expect(sorted[0]?.id).toBe(2);
    expect(sorted.map((version) => version.id).slice(1).sort((first, second) => first - second)).toEqual([1, 3]);
  });

  it('does not mutate the input', () => {
    const input = [{ id: 1, created_at: '2026-01-01T00:00:00Z' }, { id: 2, created_at: '2026-03-01T00:00:00Z' }];
    sortVersionsNewestFirst(input);
    expect(input.map((version) => version.id)).toEqual([1, 2]);
  });
});
