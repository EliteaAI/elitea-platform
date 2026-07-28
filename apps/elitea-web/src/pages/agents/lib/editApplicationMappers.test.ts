import { describe, expect, it } from 'vitest';

import type { ApplicationDetail, ApplicationVersionDetail, ApplicationVersionSummary } from '@/shared/api/generated/model';

import {
  applicationDetailDisplayName,
  toFormValues,
  toVersionDraft,
  toVersionSummaries,
} from './editApplicationMappers';

describe('toVersionSummaries', () => {
  it('maps snake_case fields to the camelCase VersionSummary shape', () => {
    const wire: readonly ApplicationVersionSummary[] = [
      { id: '1', name: 'base', status: 'draft', agent_type: 'classic', created_at: '2026-01-01T00:00:00Z' },
    ];
    expect(toVersionSummaries(wire)).toEqual([
      { id: '1', name: 'base', status: 'draft', agentType: 'classic', createdAt: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('maps an empty list to an empty list', () => {
    expect(toVersionSummaries([])).toEqual([]);
  });
});

describe('applicationDetailDisplayName', () => {
  it('returns the trimmed name when non-blank', () => {
    const detail = { name: 'My Agent' } as ApplicationDetail;
    expect(applicationDetailDisplayName(detail)).toBe('My Agent');
  });

  it('falls back to "Untitled" for a blank name', () => {
    const detail = { name: '   ' } as ApplicationDetail;
    expect(applicationDetailDisplayName(detail)).toBe('Untitled');
  });
});

describe('toFormValues', () => {
  it('seeds name/description from the detail and conversation_starters from the version', () => {
    const detail = { name: 'My Agent', description: 'A helpful agent' } as ApplicationDetail;
    const version = { conversation_starters: ['Hi', null, undefined, 'Bye'] } as unknown as ApplicationVersionDetail;
    expect(toFormValues(detail, version)).toEqual({
      name: 'My Agent',
      description: 'A helpful agent',
      version_details: { conversation_starters: ['Hi', 'Bye'] },
    });
  });

  it('defaults conversation_starters to [] when there is no version yet', () => {
    const detail = { name: 'My Agent', description: 'A helpful agent' } as ApplicationDetail;
    expect(toFormValues(detail, undefined)).toEqual({
      name: 'My Agent',
      description: 'A helpful agent',
      version_details: { conversation_starters: [] },
    });
  });
});

describe('toVersionDraft', () => {
  it('carries over name/instructions/variables/tools and the new conversation starters', () => {
    const version = {
      name: 'base',
      instructions: 'Be helpful.',
      variables: [{ name: 'x', value: '1' }],
      tools: [{ id: 't1' }],
      tags: [{ name: 'sales' }, { name: null }],
      meta: { step_limit: 40, internal_tools: ['internal_mcp', 'other'] },
    } as unknown as ApplicationVersionDetail;

    expect(toVersionDraft(version, ['Hi there'])).toEqual({
      name: 'base',
      agentType: undefined,
      instructions: 'Be helpful.',
      conversationStarters: ['Hi there'],
      variables: [{ name: 'x', value: '1' }],
      meta: { step_limit: 40, internal_tools: ['internal_mcp', 'other'] },
      tags: ['sales'],
      tools: [{ id: 't1' }],
      pipelineSettings: undefined,
    });
  });

  it('defaults meta.step_limit/internal_tools when the existing meta lacks them', () => {
    const version = { name: 'base', meta: {} } as unknown as ApplicationVersionDetail;
    const draft = toVersionDraft(version, []);
    expect(draft.meta).toEqual({ step_limit: 25, internal_tools: ['internal_mcp'] });
  });

  it('defaults instructions/variables/tags/tools to empty when absent', () => {
    const version = { name: 'base' } as ApplicationVersionDetail;
    const draft = toVersionDraft(version, []);
    expect(draft.instructions).toBe('');
    expect(draft.variables).toEqual([]);
    expect(draft.tags).toEqual([]);
    expect(draft.tools).toEqual([]);
  });

  it('sets agentType to "pipeline" only when the version agent_type is exactly "pipeline"', () => {
    const version = { name: 'base', agent_type: 'pipeline' } as ApplicationVersionDetail;
    expect(toVersionDraft(version, []).agentType).toBe('pipeline');
  });
});
