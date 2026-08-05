import { describe, expect, it } from 'vitest';

import {
  agentDisplayName,
  agentId,
  agentViewMode,
  canEditAgent,
  canEditModel,
  isPublicAgent,
  publicLlmOverride,
  PUBLIC_PROJECT_ID,
  resolveValidateProjectId,
} from './agentEditorViewState';

describe('agentId', () => {
  it('prefers entity_meta.id over id', () => {
    expect(agentId({ id: 1, entity_meta: { id: 99 } })).toBe(99);
  });

  it('falls back to id when entity_meta.id is absent', () => {
    expect(agentId({ id: 1 })).toBe(1);
  });

  it('falls back to meta.id when both entity_meta.id and id are absent', () => {
    expect(agentId({ meta: { id: 42 } })).toBe(42);
  });

  it('returns undefined for a null/undefined agent', () => {
    expect(agentId(null)).toBeUndefined();
    expect(agentId(undefined)).toBeUndefined();
  });
});

describe('isPublicAgent', () => {
  it('is true when entity_meta.project_id is the public project id', () => {
    expect(isPublicAgent({ entity_meta: { project_id: PUBLIC_PROJECT_ID } })).toBe(true);
  });

  it('is false otherwise', () => {
    expect(isPublicAgent({ entity_meta: { project_id: 'p1' } })).toBe(false);
    expect(isPublicAgent(undefined)).toBe(false);
  });
});

describe('canEditAgent', () => {
  it('is true only when not public and the user has edit permission', () => {
    expect(canEditAgent(false, true)).toBe(true);
  });

  it('is false when public even with edit permission', () => {
    expect(canEditAgent(true, true)).toBe(false);
  });

  it('is false without edit permission', () => {
    expect(canEditAgent(false, false)).toBe(false);
  });
});

describe('agentViewMode', () => {
  it('is Owner when the user can edit', () => {
    expect(agentViewMode(true)).toBe('Owner');
  });

  it('is Public otherwise', () => {
    expect(agentViewMode(false)).toBe('Public');
  });
});

describe('agentDisplayName', () => {
  it('prefers meta.name', () => {
    expect(agentDisplayName({ meta: { name: 'Meta Name' }, name: 'Top Name' })).toBe('Meta Name');
  });

  it('falls back to the top-level name', () => {
    expect(agentDisplayName({ name: 'Top Name' })).toBe('Top Name');
  });

  it('falls back to the supplied default when neither is set', () => {
    expect(agentDisplayName(undefined, 'Unnamed Agent')).toBe('Unnamed Agent');
  });
});

describe('publicLlmOverride', () => {
  it('passes the override through for a public agent', () => {
    const override = () => {};
    expect(publicLlmOverride(true, override)).toBe(override);
  });

  it('is undefined for a non-public agent, even when an override is supplied', () => {
    const override = () => {};
    expect(publicLlmOverride(false, override)).toBeUndefined();
  });

  it('is undefined when no override is supplied', () => {
    expect(publicLlmOverride(true, undefined)).toBeUndefined();
  });
});

describe('canEditModel', () => {
  it('is true when the viewer can edit the whole agent', () => {
    expect(canEditModel(true, false)).toBe(true);
  });

  it('is true when a conversation LLM override is available, even without edit permission', () => {
    expect(canEditModel(false, true)).toBe(true);
  });

  it('is false without edit permission or an override', () => {
    expect(canEditModel(false, false)).toBe(false);
  });
});

describe('resolveValidateProjectId', () => {
  it('prefers the agent\'s own numeric entity_meta.project_id, stringified', () => {
    expect(resolveValidateProjectId(42, 'p1')).toBe('42');
  });

  it('prefers the agent\'s own string entity_meta.project_id', () => {
    expect(resolveValidateProjectId('public', 'p1')).toBe('public');
  });

  it('falls back to the globally-selected project when entityProjectId is absent', () => {
    expect(resolveValidateProjectId(undefined, 'p1')).toBe('p1');
  });

  it('falls back to the globally-selected project when entityProjectId is falsy (0)', () => {
    expect(resolveValidateProjectId(0, 'p1')).toBe('p1');
  });
});
