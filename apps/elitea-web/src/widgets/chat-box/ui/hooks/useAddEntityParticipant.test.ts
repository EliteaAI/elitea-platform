import { describe, expect, it } from 'vitest';

import { findSelectedConversationParticipant, selectedParticipantInput } from './useAddEntityParticipant';

describe('selectedParticipantInput', () => {
  it('converts an OpenAPI toolkit catalog row into the participant API shape', () => {
    expect(selectedParticipantInput({
      id: '20',
      name: 'rust_openapi_echo',
      participantType: 'toolkit',
      project_id: '2',
      type: 'openapi',
    })).toMatchObject({
      entity_name: 'toolkit',
      entity_meta: { id: '20', name: 'rust_openapi_echo', project_id: '2' },
      entity_settings: { toolkit_type: 'openapi' },
    });
  });

  it('rejects a row without a supported participant type', () => {
    expect(selectedParticipantInput({ id: '20', name: 'rust_openapi_echo' })).toBeUndefined();
  });

  it('finds an attached toolkit by entity and project identity', () => {
    const participant = {
      id: '31',
      entityName: 'toolkit' as const,
      entityMeta: { id: '20', name: 'rust_openapi_echo', projectId: '2' },
      entitySettings: { toolkitType: 'openapi' },
    };

    expect(findSelectedConversationParticipant({
      id: '20',
      participantType: 'toolkit',
      project_id: '2',
      type: 'openapi',
    }, [participant])).toBe(participant);
  });

  it('matches a pipeline stored as an application with pipeline settings', () => {
    const participant = {
      id: '41',
      entityName: 'application' as const,
      entityMeta: { id: '9', projectId: '2' },
      entitySettings: { agentType: 'pipeline' },
    };

    expect(findSelectedConversationParticipant({
      id: '9',
      participantType: 'pipeline',
      project_id: '2',
      agent_type: 'pipeline',
    }, [participant])).toBe(participant);
  });

  it('does not treat a pipeline as the same plain application', () => {
    const participant = {
      id: '41',
      entityName: 'application' as const,
      entityMeta: { id: '9', projectId: '2' },
      entitySettings: { agentType: 'pipeline' },
    };

    expect(findSelectedConversationParticipant({
      id: '9',
      participantType: 'application',
      project_id: '2',
    }, [participant])).toBeUndefined();
  });
});
