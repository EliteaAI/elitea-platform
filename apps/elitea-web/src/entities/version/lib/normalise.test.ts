import { describe, expect, it } from 'vitest';

import {
  normaliseVersion,
  normaliseVersionSummaries,
  normaliseVersionSummary,
  resolveVersionTags,
  resolveVersionVariables,
} from './normalise';
import type { ApplicationVersionDetail, ApplicationVersionSummary } from '@/shared/api/generated/model';

describe('normaliseVersion', () => {
  const minimalWire: ApplicationVersionDetail = {
    id: '42',
    application_id: '7',
    name: 'v1',
    status: 'draft',
  };

  it('maps the four common required fields and adds nothing else', () => {
    expect(normaliseVersion(minimalWire)).toEqual({
      id: '42',
      applicationId: '7',
      name: 'v1',
      status: 'draft',
    });
  });

  it('preserves is_forked: false rather than dropping or defaulting it', () => {
    const result = normaliseVersion({ ...minimalWire, is_forked: false });
    expect(result.isForked).toBe(false);
    expect(Object.keys(result)).toContain('isForked');
  });

  it('preserves an empty-string instructions field rather than treating it as absent', () => {
    const result = normaliseVersion({ ...minimalWire, instructions: '' });
    expect(result.instructions).toBe('');
    expect(Object.keys(result)).toContain('instructions');
  });

  it('maps the fetchVersionDetails shape (author_id present, author absent)', () => {
    const result = normaliseVersion({
      ...minimalWire,
      created_at: '2026-01-01T00:00:00Z',
      agent_type: 'openai',
      author_id: 'u1',
      tools: [],
      tags: [],
      variables: [],
    });
    expect(result.authorId).toBe('u1');
    expect(result.author).toBeUndefined();
    expect(Object.keys(result)).not.toContain('author');
  });

  it('maps the CreateVersion shape (author present, author_id absent) — disjoint fields', () => {
    const result = normaliseVersion({
      ...minimalWire,
      author: { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace' },
      is_forked: true,
    });
    expect(result.author).toEqual({ id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace' });
    expect(result.authorId).toBeUndefined();
    expect(Object.keys(result)).not.toContain('authorId');
  });

  it('maps the UpdateVersion shape (no created_at/author/tools present)', () => {
    const result = normaliseVersion({
      ...minimalWire,
      welcome_message: 'hi',
      llm_settings: { model_name: 'gpt-4' },
    });
    expect(result.createdAt).toBeUndefined();
    expect(result.author).toBeUndefined();
    expect(result.tools).toBeUndefined();
    expect(result.welcomeMessage).toBe('hi');
    expect(result.llmSettings).toEqual({ model_name: 'gpt-4' });
  });

  describe('meta', () => {
    it('omits meta entirely when the wire key is absent', () => {
      const result = normaliseVersion(minimalWire);
      expect(Object.keys(result)).not.toContain('meta');
    });

    it('keeps an explicit null meta as null rather than dropping the key', () => {
      const result = normaliseVersion({ ...minimalWire, meta: null });
      expect(result.meta).toBeNull();
      expect(Object.keys(result)).toContain('meta');
    });

    it('renames nested meta fields and the attachment_storage sub-object', () => {
      const result = normaliseVersion({
        ...minimalWire,
        meta: {
          step_limit: 5,
          icon_meta: { emoji: 'rocket' },
          category: 'assistant',
          source_version_id: '10',
          parent_entity_id: '11',
          parent_project_id: '12',
          parent_author_id: '13',
          attachment_storage: { toolkit_id: 'tk-1' },
        },
      });
      expect(result.meta).toEqual({
        stepLimit: 5,
        iconMeta: { emoji: 'rocket' },
        category: 'assistant',
        sourceVersionId: '10',
        parentEntityId: '11',
        parentProjectId: '12',
        parentAuthorId: '13',
        attachmentStorage: { toolkitId: 'tk-1' },
      });
    });

    it('preserves a null step_limit rather than dropping the key', () => {
      const result = normaliseVersion({ ...minimalWire, meta: { step_limit: null } });
      expect(result.meta).toEqual({ stepLimit: null });
    });

    it('drops attachmentStorage.toolkitId when the wire omits it but keeps the sub-object', () => {
      const result = normaliseVersion({ ...minimalWire, meta: { attachment_storage: {} } });
      expect(result.meta).toEqual({ attachmentStorage: {} });
    });
  });

  describe('tools', () => {
    it('renames the entity_tool_mapping row shape', () => {
      const result = normaliseVersion({
        ...minimalWire,
        tools: [{ id: 1, tool_id: 99, entity_type: 'toolkit', selected_tools: { a: 1 } }],
      });
      expect(result.tools).toEqual([{ id: 1, toolId: 99, entityType: 'toolkit', selectedTools: { a: 1 } }]);
    });

    it('renames the application_tools row shape', () => {
      const result = normaliseVersion({
        ...minimalWire,
        tools: [{ id: 2, name: 'search', type: 'function', settings: { key: 'v' }, author_id: 'u1', project_id: 3 }],
      });
      expect(result.tools).toEqual([
        { id: 2, name: 'search', type: 'function', settings: { key: 'v' }, authorId: 'u1', projectId: 3 },
      ]);
    });

    it('returns an empty array for an empty tools list rather than omitting the key', () => {
      const result = normaliseVersion({ ...minimalWire, tools: [] });
      expect(result.tools).toEqual([]);
    });
  });

  describe('tags', () => {
    it('collapses an absent name to null, matching the explicit-null Fork echo case', () => {
      const result = normaliseVersion({ ...minimalWire, tags: [{ data: { x: 1 } }, { name: null }, { name: 'kept' }] });
      expect(result.tags).toEqual([{ name: null, data: { x: 1 } }, { name: null }, { name: 'kept' }]);
    });

    it('omits the data key when absent rather than setting it to undefined', () => {
      const result = normaliseVersion({ ...minimalWire, tags: [{ name: 'no-data' }] });
      expect(result.tags?.[0]).toEqual({ name: 'no-data' });
      expect(Object.keys(result.tags?.[0] ?? {})).toEqual(['name']);
    });
  });

  it('passes variables through unchanged (wire and domain shapes already match)', () => {
    const result = normaliseVersion({
      ...minimalWire,
      variables: [{ name: 'a', value: '1' }, { name: null, value: 'orphan' }, {}],
    });
    expect(result.variables).toEqual([{ name: 'a', value: '1' }, { name: null, value: 'orphan' }, {}]);
  });
});

describe('normaliseVersionSummary', () => {
  const wire: ApplicationVersionSummary = {
    id: '1',
    name: 'base',
    status: 'published',
    agent_type: 'openai',
    created_at: '2026-01-01T00:00:00Z',
  };

  it('maps snake_case wire fields to camelCase', () => {
    expect(normaliseVersionSummary(wire)).toEqual({
      id: '1',
      name: 'base',
      status: 'published',
      agentType: 'openai',
      createdAt: '2026-01-01T00:00:00Z',
    });
  });
});

describe('normaliseVersionSummaries', () => {
  const wire: ApplicationVersionSummary = {
    id: '1',
    name: 'base',
    status: 'published',
    agent_type: 'openai',
    created_at: '2026-01-01T00:00:00Z',
  };

  it('maps every entry in order', () => {
    const second: ApplicationVersionSummary = { ...wire, id: '2', name: 'v2' };
    expect(normaliseVersionSummaries([wire, second]).map((v) => v.id)).toEqual(['1', '2']);
  });

  it('returns an empty array for an empty input', () => {
    expect(normaliseVersionSummaries([])).toEqual([]);
  });
});

describe('resolveVersionVariables', () => {
  it('prefers top-level variables over meta.variables', () => {
    const result = resolveVersionVariables({
      variables: [{ name: 'top', value: '1' }],
      meta: { variables: [{ name: 'nested', value: '2' }] },
    });
    expect(result).toEqual([{ name: 'top', value: '1' }]);
  });

  it('falls back to meta.variables when the top-level array is absent', () => {
    const result = resolveVersionVariables({
      meta: { variables: [{ name: 'nested', value: '2' }] },
    });
    expect(result).toEqual([{ name: 'nested', value: '2' }]);
  });

  it('drops entries with a null name', () => {
    const result = resolveVersionVariables({
      variables: [{ name: 'kept', value: '1' }, { name: null, value: 'orphan' }],
    });
    expect(result).toEqual([{ name: 'kept', value: '1' }]);
  });

  it('returns an empty array when nothing is present anywhere', () => {
    expect(resolveVersionVariables({})).toEqual([]);
  });
});

describe('resolveVersionTags', () => {
  it('drops tags with a null name', () => {
    const result = resolveVersionTags([
      { name: 'kept', data: { a: 1 } },
      { name: null, data: 'orphan' },
    ]);
    expect(result).toEqual([{ name: 'kept', data: { a: 1 } }]);
  });

  it('omits the data key when absent rather than setting it to undefined', () => {
    const result = resolveVersionTags([{ name: 'no-data' }]);
    expect(result).toEqual([{ name: 'no-data' }]);
    expect(Object.keys(result[0] ?? {})).toEqual(['name']);
  });

  it('returns an empty array for an empty input', () => {
    expect(resolveVersionTags([])).toEqual([]);
  });
});
