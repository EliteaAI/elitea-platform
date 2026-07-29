import { describe, expect, it } from 'vitest';

import { filterEntityItems } from './useFilteredEntityItems';
import type { Participant } from './types';
import type { ParticipantEntityItem } from './participantCandidates';

function item(label: string, data: Readonly<Record<string, unknown>>, isPublic = false): ParticipantEntityItem {
  return { label, participantType: 'application', isPublic, data };
}

describe('filterEntityItems', () => {
  it('excludes an application already present as a participant', () => {
    const entityItems = [item('Agent A', { id: 'a1', project_id: '7' }), item('Agent B', { id: 'a2', project_id: '7' })];
    const participants: Participant[] = [
      { id: '1', entityName: 'application', entityMeta: { id: 'a1', projectId: '7' } },
    ];
    const result = filterEntityItems(entityItems, participants, 'application', '');
    expect(result.map((r) => r.label)).toEqual(['Agent B']);
  });

  it('does not exclude a pipeline-flagged participant when filtering the application bucket', () => {
    const entityItems = [item('Agent A', { id: 'a1', project_id: '7' })];
    const participants: Participant[] = [
      { id: '1', entityName: 'application', entityMeta: { id: 'a1', projectId: '7' }, entitySettings: { agentType: 'pipeline' } },
    ];
    const result = filterEntityItems(entityItems, participants, 'application', '');
    expect(result.map((r) => r.label)).toEqual(['Agent A']);
  });

  it('excludes a matching pipeline when filtering the pipeline bucket', () => {
    const entityItems = [item('Pipeline A', { id: 'p1', project_id: '7' })];
    const participants: Participant[] = [
      { id: '1', entityName: 'application', entityMeta: { id: 'p1', projectId: '7' }, entitySettings: { agentType: 'pipeline' } },
    ];
    const result = filterEntityItems(entityItems, participants, 'pipeline', '');
    expect(result).toEqual([]);
  });

  it('filters by label search, case-insensitively', () => {
    const entityItems = [item('Github Toolkit', {}), item('Jira Toolkit', {})];
    const result = filterEntityItems(entityItems, [], 'toolkit', 'github');
    expect(result.map((r) => r.label)).toEqual(['Github Toolkit']);
  });

  it('also matches toolkit type/settings.elitea_title/settings.configuration_title', () => {
    const entityItems = [
      item('Custom Name', { type: 'jira' }),
      item('Another', { settings: { elitea_title: 'Special Title' } }),
      item('Third', { settings: { configuration_title: 'Config Match' } }),
    ];
    expect(filterEntityItems(entityItems, [], 'toolkit', 'jira').map((r) => r.label)).toEqual(['Custom Name']);
    expect(filterEntityItems(entityItems, [], 'toolkit', 'special').map((r) => r.label)).toEqual(['Another']);
    expect(filterEntityItems(entityItems, [], 'toolkit', 'config match').map((r) => r.label)).toEqual(['Third']);
  });

  it('sorts public items after private items, then alphabetically', () => {
    const entityItems = [
      item('Zeta', {}, false),
      item('Alpha', {}, true),
      item('Beta', {}, false),
    ];
    const result = filterEntityItems(entityItems, [], 'application', '');
    expect(result.map((r) => r.label)).toEqual(['Beta', 'Zeta', 'Alpha']);
  });

  it('always returns [] for the "user" participantType, matching the old hook\'s missing Users case', () => {
    const entityItems = [item('Someone', {})];
    expect(filterEntityItems(entityItems, [], 'user', '')).toEqual([]);
  });
});
