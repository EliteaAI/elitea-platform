import { describe, expect, it } from 'vitest';

import type { ApplicationDetail, ApplicationVersionDetail, ApplicationVersionSummary } from '@/shared/api/generated/model';

import {
  pipelineDetailDisplayName,
  toFormValues,
  toVersionDraft,
  toVersionSummaries,
} from './editPipelineMappers';

describe('toVersionSummaries', () => {
  it('maps snake_case fields to the camelCase VersionSummary shape', () => {
    const wire: readonly ApplicationVersionSummary[] = [
      { id: '1', name: 'base', status: 'draft', agent_type: 'pipeline', created_at: '2026-01-01T00:00:00Z' },
    ];
    expect(toVersionSummaries(wire)).toEqual([
      { id: '1', name: 'base', status: 'draft', agentType: 'pipeline', createdAt: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('maps an empty list to an empty list', () => {
    expect(toVersionSummaries([])).toEqual([]);
  });
});

describe('pipelineDetailDisplayName', () => {
  it('returns the trimmed name when non-blank', () => {
    const detail = { name: 'My Pipeline' } as ApplicationDetail;
    expect(pipelineDetailDisplayName(detail)).toBe('My Pipeline');
  });

  it('falls back to "Untitled" for a blank name', () => {
    const detail = { name: '   ' } as ApplicationDetail;
    expect(pipelineDetailDisplayName(detail)).toBe('Untitled');
  });
});

describe('toFormValues', () => {
  it('seeds name/description from the detail and conversation_starters from the version', () => {
    const detail = { name: 'My Pipeline', description: 'A helpful pipeline' } as ApplicationDetail;
    const version = { conversation_starters: ['Hi', null, undefined, 'Bye'] } as unknown as ApplicationVersionDetail;
    expect(toFormValues(detail, version)).toEqual({
      name: 'My Pipeline',
      description: 'A helpful pipeline',
      version_details: { conversation_starters: ['Hi', 'Bye'] },
    });
  });

  it('defaults conversation_starters to [] when there is no version yet', () => {
    const detail = { name: 'My Pipeline', description: 'A helpful pipeline' } as ApplicationDetail;
    expect(toFormValues(detail, undefined)).toEqual({
      name: 'My Pipeline',
      description: 'A helpful pipeline',
      version_details: { conversation_starters: [] },
    });
  });
});

describe('toVersionDraft', () => {
  it('carries over name/instructions/variables/tools and the new conversation starters, forcing agentType to "pipeline"', () => {
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
      agentType: 'pipeline',
      instructions: 'Be helpful.',
      conversationStarters: ['Hi there'],
      variables: [{ name: 'x', value: '1' }],
      meta: { step_limit: 40, internal_tools: ['internal_mcp', 'other'] },
      tags: ['sales'],
      tools: [{ id: 't1' }],
      pipelineSettings: undefined,
    });
  });

  // #135: `pipelineSettings` used to be hardcoded `undefined` and
  // `instructions` always came from the STORED version, so a graph edit could
  // not reach the wire even in principle.
  it('prefers the live graph draft for instructions and carries its pipelineSettings', () => {
    const version = { name: 'base', instructions: 'stale yaml', meta: {} } as unknown as ApplicationVersionDetail;
    const graph = {
      instructions: 'entry_point: Agent 1\n',
      pipelineSettings: {
        nodes: [{ id: 'Agent 1' }],
        edges: [],
        orientation: 'vertical',
        layout_version: '1.0',
      },
    };

    const draft = toVersionDraft(version, [], graph);

    expect(draft.instructions).toBe('entry_point: Agent 1\n');
    expect(draft.pipelineSettings).toEqual(graph.pipelineSettings);
  });

  it('keeps the stored instructions and leaves pipelineSettings undefined when no graph draft is supplied', () => {
    const version = { name: 'base', instructions: 'stale yaml', meta: {} } as unknown as ApplicationVersionDetail;

    const draft = toVersionDraft(version, [], undefined);

    expect(draft.instructions).toBe('stale yaml');
    expect(draft.pipelineSettings).toBeUndefined();
  });

  /*
   * The `internal_tools` fallback used to be `['internal_mcp']`, which the
   * chat query refuses: it admits a version only when
   * `COALESCE(meta -> 'internal_tools', '[]') IN ('[]', '["ask_user"]')`
   * (`services/elitea-main/internal/db/queries/agent_chat.sql:359-362`), so a
   * stored version with NO `internal_tools` key — which answers turns fine
   * today, thanks to that COALESCE — was quietly given one the first time a
   * user saved any unrelated edit, and stopped answering with a 422.
   */
  it('falls back to an EMPTY meta.internal_tools (never internal_mcp) when the existing meta lacks the key', () => {
    const version = { name: 'base', meta: {} } as unknown as ApplicationVersionDetail;
    const draft = toVersionDraft(version, []);
    expect(draft.meta).toEqual({ step_limit: 25, internal_tools: [] });
  });

  it('falls back to an EMPTY meta.internal_tools when the stored value is not an array', () => {
    const version = {
      name: 'base',
      meta: { internal_tools: 'internal_mcp' },
    } as unknown as ApplicationVersionDetail;
    expect(toVersionDraft(version, []).meta.internal_tools).toEqual([]);
  });

  // The other direction, and the reason the fallback is the ONLY thing that
  // changed: a user who deliberately turned Elitea MCP Tools on must still
  // find it on when the editor reloads their version.
  it('round-trips an explicitly stored internal_mcp unchanged', () => {
    const version = {
      name: 'base',
      meta: { internal_tools: ['internal_mcp'] },
    } as unknown as ApplicationVersionDetail;
    expect(toVersionDraft(version, []).meta.internal_tools).toEqual(['internal_mcp']);
  });

  it('defaults instructions/variables/tags/tools to empty when absent', () => {
    const version = { name: 'base' } as ApplicationVersionDetail;
    const draft = toVersionDraft(version, []);
    expect(draft.instructions).toBe('');
    expect(draft.variables).toEqual([]);
    expect(draft.tags).toEqual([]);
    expect(draft.tools).toEqual([]);
  });

  it('always sets agentType to "pipeline", regardless of the wire agent_type', () => {
    const version = { name: 'base', agent_type: 'classic' } as unknown as ApplicationVersionDetail;
    expect(toVersionDraft(version, []).agentType).toBe('pipeline');
  });

  it('always sets pipelineSettings to undefined (disclosed gap, not a fabricated value)', () => {
    const version = { name: 'base' } as ApplicationVersionDetail;
    expect(toVersionDraft(version, []).pipelineSettings).toBeUndefined();
  });

  it('reads the stored llm_settings back, with model_project_id as a number', () => {
    const version = {
      name: 'base',
      llm_settings: { model_name: 'qwen3.5', model_project_id: '17', max_tokens: -1, temperature: 0.6 },
    } as unknown as ApplicationVersionDetail;

    expect(toVersionDraft(version, []).llmSettings).toEqual({
      model_name: 'qwen3.5',
      model_project_id: 17,
      max_tokens: -1,
      temperature: 0.6,
    });
  });

  // Same edit-wins-over-stored rule the agents twin applies in
  // `toVersionWriteBody`: the page's model picker holds the live choice and a
  // save that re-read the stored blob would drop it.
  it('prefers the picked llm_settings over the stored one', () => {
    const version = {
      name: 'base',
      llm_settings: { model_name: 'gpt-4o', model_project_id: 3, max_tokens: 4096 },
    } as unknown as ApplicationVersionDetail;

    const draft = toVersionDraft(version, [], undefined, {
      model_name: 'qwen3.5',
      model_project_id: 17,
      max_tokens: -1,
    });
    expect(draft.llmSettings).toEqual({ model_name: 'qwen3.5', model_project_id: 17, max_tokens: -1 });
  });

  // `{}` is what every version written before the picker existed stores;
  // `toVersionWriteRequest` then omits the key and the pipeline keeps running
  // on the project's catalogue default.
  it('leaves llmSettings undefined for a version that names no model', () => {
    const version = { name: 'base', llm_settings: {} } as unknown as ApplicationVersionDetail;
    expect(toVersionDraft(version, []).llmSettings).toBeUndefined();
  });
});
