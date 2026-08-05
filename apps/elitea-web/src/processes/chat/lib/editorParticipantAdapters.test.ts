import { describe, expect, it } from 'vitest';

import type { Participant } from '@/entities/participant';

import {
  readAgentParticipantSnapshot,
  readPipelineParticipantSnapshot,
  readToolkitParticipantSnapshot,
  toAgentParticipantSnapshot,
  toPipelineParticipantSnapshot,
  toToolkitParticipantSnapshot,
} from './editorParticipantAdapters';

const AGENT_PARTICIPANT: Participant = {
  id: '42',
  entityName: 'application',
  entityMeta: { id: '42', name: 'My Agent', projectId: 'proj-1' },
  entitySettings: {
    versionId: 'v1',
    variables: [{ name: 'x', value: '1' }, { name: 'bad' }, 'not-an-object' as unknown as { name?: string }],
    llmSettings: { model_name: 'gpt' },
  },
  meta: { id: 'meta-42', name: 'My Agent Meta' },
};

describe('toAgentParticipantSnapshot', () => {
  it('maps camelCase Participant fields to the snake_case agent shape', () => {
    const snapshot = toAgentParticipantSnapshot(AGENT_PARTICIPANT);
    expect(snapshot).toEqual({
      id: '42',
      entity_meta: { id: '42', project_id: 'proj-1' },
      entity_settings: {
        version_id: 'v1',
        variables: [{ name: 'x', value: '1' }, { name: 'bad' }, {}],
        llm_settings: { model_name: 'gpt' },
      },
      meta: { id: 'meta-42', name: 'My Agent Meta' },
    });
  });

  it('omits entity_meta/entity_settings/meta entirely when the Participant has none', () => {
    const snapshot = toAgentParticipantSnapshot({ id: '1', entityName: 'application' });
    expect(snapshot).toEqual({ id: '1' });
  });
});

describe('readAgentParticipantSnapshot', () => {
  it('round-trips an encoded snapshot back out of a loose EditorOpenInfo record', () => {
    const encoded = { ...toAgentParticipantSnapshot(AGENT_PARTICIPANT) };
    expect(readAgentParticipantSnapshot(encoded)).toEqual(toAgentParticipantSnapshot(AGENT_PARTICIPANT));
  });

  it('returns undefined for undefined/id-less info', () => {
    expect(readAgentParticipantSnapshot(undefined)).toBeUndefined();
    expect(readAgentParticipantSnapshot({ entity_meta: { id: '1' } })).toBeUndefined();
  });

  it('ignores wrongly-typed fields defensively', () => {
    expect(readAgentParticipantSnapshot({ id: '1', entity_meta: 'not-an-object', entity_settings: 42, meta: 'nope' })).toEqual({ id: '1' });
  });
});

const PIPELINE_PARTICIPANT: Participant = {
  id: '7',
  entityName: 'pipeline',
  entityMeta: { id: '7', projectId: 'public' },
  entitySettings: { versionId: 3 },
  meta: { name: 'My Pipeline' },
};

describe('toPipelineParticipantSnapshot', () => {
  it('maps camelCase Participant fields to the snake_case pipeline shape', () => {
    expect(toPipelineParticipantSnapshot(PIPELINE_PARTICIPANT)).toEqual({
      id: '7',
      entity_meta: { id: '7', project_id: 'public' },
      entity_settings: { version_id: 3 },
      meta: { name: 'My Pipeline' },
      participantType: 'pipeline',
    });
  });
});

describe('readPipelineParticipantSnapshot', () => {
  it('round-trips an encoded snapshot', () => {
    const encoded = { ...toPipelineParticipantSnapshot(PIPELINE_PARTICIPANT) };
    expect(readPipelineParticipantSnapshot(encoded)).toEqual(toPipelineParticipantSnapshot(PIPELINE_PARTICIPANT));
  });

  it('returns undefined without a usable id', () => {
    expect(readPipelineParticipantSnapshot({})).toBeUndefined();
  });
});

const TOOLKIT_PARTICIPANT: Participant = {
  id: '9',
  entityName: 'toolkit',
  entityMeta: { id: '9', projectId: 'proj-2', name: 'My Toolkit' },
  meta: { id: 'meta-9', mcp: true, name: 'My Toolkit Meta' },
};

describe('toToolkitParticipantSnapshot', () => {
  it('maps camelCase Participant fields to the snake_case toolkit shape, deriving isMCP from meta.mcp', () => {
    expect(toToolkitParticipantSnapshot(TOOLKIT_PARTICIPANT)).toEqual({
      id: '9',
      isMCP: true,
      entity_meta: { id: '9', project_id: 'proj-2', name: 'My Toolkit' },
      meta: { id: 'meta-9', mcp: true, name: 'My Toolkit Meta' },
    });
  });
});

describe('readToolkitParticipantSnapshot', () => {
  it('round-trips an encoded snapshot', () => {
    const encoded = { ...toToolkitParticipantSnapshot(TOOLKIT_PARTICIPANT) };
    expect(readToolkitParticipantSnapshot(encoded)).toEqual(toToolkitParticipantSnapshot(TOOLKIT_PARTICIPANT));
  });

  it('returns undefined for undefined info', () => {
    expect(readToolkitParticipantSnapshot(undefined)).toBeUndefined();
  });
});
