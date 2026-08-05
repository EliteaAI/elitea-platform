import { describe, expect, it } from 'vitest';

import { normaliseParticipant, normaliseParticipants } from './normalise';

describe('normaliseParticipant', () => {
  it('stringifies the numeric wire id and maps entity_meta/meta/entity_settings to camelCase', () => {
    const result = normaliseParticipant({
      id: 42,
      entity_name: 'application',
      entity_meta: { id: 'a1', name: 'Agent', project_id: '7', model_name: 'gpt-4', integration_uid: 'iu-1' },
      meta: { name: 'Agent', user_name: 'alice', user_avatar: 'a.png', is_container: true, mcp: false },
      entity_settings: {
        llm_settings: { temperature: 0.5 },
        version_id: 'v1',
        variables: [{ name: 'x' }],
        icon_meta: { emoji: '🤖' },
        toolkit_type: 'github',
        agent_type: 'pipeline',
        mcp_server_url: 'https://mcp.example',
      },
    });

    expect(result).toEqual({
      id: '42',
      entityName: 'application',
      entityMeta: { id: 'a1', name: 'Agent', projectId: '7', modelName: 'gpt-4', integrationUid: 'iu-1' },
      meta: { name: 'Agent', userName: 'alice', userAvatar: 'a.png', isContainer: true, mcp: false },
      entitySettings: {
        llmSettings: { temperature: 0.5 },
        versionId: 'v1',
        variables: [{ name: 'x' }],
        iconMeta: { emoji: '🤖' },
        toolkitType: 'github',
        agentType: 'pipeline',
        mcpServerUrl: 'https://mcp.example',
      },
    });
  });

  it('omits entityMeta/meta/entitySettings entirely when the wire field is null or absent', () => {
    const result = normaliseParticipant({ id: 1, entity_name: 'user' });
    expect(result).toEqual({ id: '1', entityName: 'user' });
    expect('entityMeta' in result).toBe(false);
    expect('meta' in result).toBe(false);
    expect('entitySettings' in result).toBe(false);
  });

  it('falls back an unrecognised entity_name to "dummy"', () => {
    const result = normaliseParticipant({ id: 1, entity_name: 'not-a-type' });
    expect(result.entityName).toBe('dummy');
  });

  it('accepts every real ParticipantType wire value', () => {
    for (const type of ['application', 'toolkit', 'llm', 'user', 'pipeline', 'skill', 'dummy'] as const) {
      expect(normaliseParticipant({ id: 1, entity_name: type }).entityName).toBe(type);
    }
  });
});

describe('normaliseParticipants', () => {
  it('maps an array', () => {
    const result = normaliseParticipants([
      { id: 1, entity_name: 'user' },
      { id: 2, entity_name: 'toolkit' },
    ]);
    expect(result).toEqual([
      { id: '1', entityName: 'user' },
      { id: '2', entityName: 'toolkit' },
    ]);
  });
});
