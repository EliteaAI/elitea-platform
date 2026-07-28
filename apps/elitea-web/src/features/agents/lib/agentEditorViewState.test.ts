import { describe, expect, it } from 'vitest';

import {
  agentDisplayName,
  agentId,
  agentViewMode,
  canEditAgent,
  isPublicAgent,
  PUBLIC_PROJECT_ID,
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
