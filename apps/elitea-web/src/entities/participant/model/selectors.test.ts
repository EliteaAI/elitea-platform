import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PARTICIPANT_NAME,
  chatParticipantUniqueId,
  isParticipantStillActive,
  isSkippedContainerParticipant,
  participantDisplayName,
} from './selectors';
import type { Participant } from './types';

const participant = (overrides: Partial<Participant> = {}): Participant => ({
  id: '1',
  entityName: 'application',
  ...overrides,
});

describe('chatParticipantUniqueId', () => {
  it('keys an application with agentType pipeline as a pipeline', () => {
    const id = chatParticipantUniqueId(
      participant({
        entityName: 'application',
        entitySettings: { agentType: 'pipeline' },
        entityMeta: { id: 'e1', projectId: 'p1' },
      }),
    );
    expect(id).toBe('pipeline_e1_p1');
  });

  it('keys a plain application by entityMeta.id', () => {
    const id = chatParticipantUniqueId(participant({ entityMeta: { id: 'e1', projectId: 'p1' } }));
    expect(id).toBe('application_e1_p1');
  });

  it('composes modelName-integrationUid for llm participants', () => {
    const id = chatParticipantUniqueId(
      participant({
        entityName: 'llm',
        entityMeta: { modelName: 'gpt-4', integrationUid: 'int-1', projectId: 'p1' },
      }),
    );
    expect(id).toBe('llm_gpt-4-int-1_p1');
  });

  it('defaults projectId to an empty string when absent', () => {
    expect(chatParticipantUniqueId(participant({ entityMeta: { id: 'e1' } }))).toBe('application_e1_');
  });
});

describe('participantDisplayName', () => {
  it('prefers entityMeta.name for application/pipeline/toolkit/skill', () => {
    expect(
      participantDisplayName(participant({ entityMeta: { name: 'Meta Name' }, meta: { name: 'Meta Fallback' } })),
    ).toBe('Meta Name');
  });

  it('falls back to meta.name when entityMeta.name is absent', () => {
    expect(participantDisplayName(participant({ meta: { name: 'Meta Fallback' } }))).toBe('Meta Fallback');
  });

  it('uses entityMeta.modelName for llm', () => {
    expect(participantDisplayName(participant({ entityName: 'llm', entityMeta: { modelName: 'gpt-4' } }))).toBe(
      'gpt-4',
    );
  });

  it('uses meta.userName for user', () => {
    expect(participantDisplayName(participant({ entityName: 'user', meta: { userName: 'Alice' } }))).toBe('Alice');
  });

  it('uses the system sender name for dummy', () => {
    expect(participantDisplayName(participant({ entityName: 'dummy' }))).toBe(DEFAULT_PARTICIPANT_NAME);
  });

  it('accepts a custom system sender name', () => {
    expect(participantDisplayName(participant({ entityName: 'dummy' }), 'Custom')).toBe('Custom');
  });

  it('returns an empty string when nothing resolves', () => {
    expect(participantDisplayName(participant({ entityName: 'application' }))).toBe('');
  });

  it('returns an empty string for an unrecognised entityName (defensive default branch)', () => {
    const malformed = participant({ entityName: 'unknown_type' as Participant['entityName'] });
    expect(participantDisplayName(malformed)).toBe('');
  });
});

describe('isSkippedContainerParticipant', () => {
  it('is true for a container application that is not a pipeline', () => {
    expect(isSkippedContainerParticipant(participant({ meta: { isContainer: true } }))).toBe(true);
  });

  it('is false when isContainer is not exactly true', () => {
    expect(isSkippedContainerParticipant(participant({ meta: { isContainer: false } }))).toBe(false);
  });

  it('is false for a non-application entity even if isContainer is true', () => {
    expect(isSkippedContainerParticipant(participant({ entityName: 'toolkit', meta: { isContainer: true } }))).toBe(
      false,
    );
  });

  it('is false when the application is actually a pipeline via entitySettings', () => {
    expect(
      isSkippedContainerParticipant(
        participant({ meta: { isContainer: true }, entitySettings: { agentType: 'pipeline' } }),
      ),
    ).toBe(false);
  });

  it('is false when the application is a pipeline via the top-level agentType fallback', () => {
    expect(isSkippedContainerParticipant(participant({ meta: { isContainer: true }, agentType: 'pipeline' }))).toBe(
      false,
    );
  });
});

describe('isParticipantStillActive', () => {
  it('is true for an application with a meta.name', () => {
    expect(isParticipantStillActive(participant({ meta: { name: 'x' } }))).toBe(true);
  });

  it('is false for an application without a meta.name', () => {
    expect(isParticipantStillActive(participant())).toBe(false);
  });

  it('is true for an llm with a modelName', () => {
    expect(isParticipantStillActive(participant({ entityName: 'llm', entityMeta: { modelName: 'gpt-4' } }))).toBe(
      true,
    );
  });

  it('is always true for dummy', () => {
    expect(isParticipantStillActive(participant({ entityName: 'dummy' }))).toBe(true);
  });

  it('is false for user (not in the active-check switch)', () => {
    expect(isParticipantStillActive(participant({ entityName: 'user', meta: { userName: 'x' } }))).toBe(false);
  });
});
