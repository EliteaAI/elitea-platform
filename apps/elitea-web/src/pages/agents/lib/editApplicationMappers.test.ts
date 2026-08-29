import { describe, expect, it } from 'vitest';

import type { ApplicationDetail, ApplicationVersionDetail, ApplicationVersionSummary } from '@/shared/api/generated/model';
import { VersionWriteRequest } from '@/shared/api/generated/model/versionWriteRequest.zod';

import {
  applicationDetailDisplayName,
  toFormValues,
  toVersionDraft,
  toVersionOptions,
  toVersionSaveBody,
  toVersionSummaries,
  toVersionWriteBody,
} from './editApplicationMappers';

describe('toVersionOptions', () => {
  it('narrows the wire\'s string ids to numbers so the selector can match the active version', () => {
    const wire: readonly ApplicationVersionSummary[] = [
      { id: '7', name: 'base', status: 'draft', agent_type: 'classic', created_at: '2026-01-01T00:00:00Z' },
    ];
    expect(toVersionOptions(wire)).toEqual([
      { id: 7, name: 'base', status: 'draft', created_at: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('maps an empty list to an empty list', () => {
    expect(toVersionOptions([])).toEqual([]);
  });
});

describe('toVersionWriteBody', () => {
  it('clones the fields the CreateVersion handler actually reads, with the live starters', () => {
    const version = {
      id: '1',
      name: 'base',
      agent_type: 'classic',
      instructions: 'be helpful',
      welcome_message: 'hi',
      llm_settings: { model_name: 'gpt' },
      variables: [{ name: 'k', value: 'v' }],
      meta: { step_limit: 25 },
      tags: [{ name: 'x' }],
    } as unknown as ApplicationVersionDetail;

    expect(toVersionWriteBody(version, ['s1'])).toEqual({
      agent_type: 'classic',
      instructions: 'be helpful',
      welcome_message: 'hi',
      llm_settings: { model_name: 'gpt' },
      conversation_starters: ['s1'],
      variables: [{ name: 'k', value: 'v' }],
    });
  });

  it('omits keys the handler discards and defaults absent text fields to empty strings', () => {
    const version = { id: '1', name: 'base' } as ApplicationVersionDetail;
    const body = toVersionWriteBody(version, []);

    expect(body).toEqual({ instructions: '', welcome_message: '', conversation_starters: [], variables: [] });
    expect(body).not.toHaveProperty('meta');
    expect(body).not.toHaveProperty('tags');
    expect(body).not.toHaveProperty('agent_type');
  });
});

describe('toVersionSaveBody', () => {
  /*
   * This asserts the CONTRACT, not the mapper: `VersionWriteRequest` is the
   * generated zod schema, and zod object parsing STRIPS keys the schema does
   * not declare. So the assertion below fails outright if `internal_tools`
   * is ever dropped from `VersionMeta` in
   * `services/elitea-main/api/openapi/v2.yaml` — which is exactly the state
   * this test was written to rule out. `zod.record`-style passthrough would
   * not make it pass either: the generated `VersionMeta` is a plain
   * `zod.object`, so the key has to be modelled by name.
   */
  it('survives a round trip through the generated VersionWriteRequest schema', () => {
    const version = {
      name: 'base',
      meta: { step_limit: 40, internal_tools: ['internal_mcp'], category: 'sales' },
    } as unknown as ApplicationVersionDetail;
    const edits = {
      instructions: 'Be helpful.',
      welcomeMessage: '',
      variables: [],
      stepLimit: 12,
      internalTools: ['internal_mcp', 'internal_web'],
    };

    const body = toVersionSaveBody(version, [], edits);
    expect(body.meta?.internal_tools).toEqual(['internal_mcp', 'internal_web']);

    const parsed = VersionWriteRequest.parse(body);
    expect(parsed.meta?.internal_tools).toEqual(['internal_mcp', 'internal_web']);
    // The untouched keys ride along through the same merge.
    expect(parsed.meta?.step_limit).toBe(12);
    expect(parsed.meta?.category).toBe('sales');
  });
});

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

  it('sets agentType to "pipeline" only when the version agent_type is exactly "pipeline"', () => {
    const version = { name: 'base', agent_type: 'pipeline' } as ApplicationVersionDetail;
    expect(toVersionDraft(version, []).agentType).toBe('pipeline');
  });
});
