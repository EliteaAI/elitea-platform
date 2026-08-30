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

  /**
   * `user` is false in the BASELINE too (`participants.helpers.js:64-77` has
   * no Users case, so it takes `default: return false`), and that is correct
   * for the one thing the baseline uses this for: gating Regenerate on the
   * last message (`ChatMessageWrapper.jsx:148`). It is not a visibility
   * predicate, which is why the participants rail no longer calls it — see
   * `features/chat-participants/ui/Participants.tsx`.
   */
  it('is false for user — a re-addressability answer, not a visibility one', () => {
    expect(isParticipantStillActive(participant({ entityName: 'user', meta: { userName: 'x' } }))).toBe(false);
  });

  it('is false for toolkit and pipeline, matching the baseline default arm', () => {
    expect(isParticipantStillActive(participant({ entityName: 'toolkit', meta: { name: 'Jira' } }))).toBe(false);
    expect(isParticipantStillActive(participant({ entityName: 'pipeline', meta: { name: 'P' } }))).toBe(false);
  });
});

/**
 * The rows this predicate is actually handed in production: raw snake_case
 * participants straight off `GET /elitea_core/conversation/prompt_lib/{p}/{c}`
 * — `id`/`entity_name`/`entity_meta`/`entity_settings`/`meta`, with
 * `meta.user_name` overlaid server-side by `ListParticipants`. Nothing in
 * `features/chat-participants` normalises them into the camelCase domain
 * shape, so the first port answered `undefined` for every one of them and the
 * participants rail dropped whole groups. These cases are the wire shapes
 * verbatim, including the enriched `meta.user_name` row.
 */
describe('isParticipantStillActive — raw wire rows', () => {
  it('answers for an application row keyed `entity_name`', () => {
    const live = {
      id: 41,
      entity_name: 'application',
      entity_meta: { id: '9', project_id: '1', name: 'autotest_m2ag' },
      entity_settings: { version_id: 12 },
      meta: { name: 'autotest_m2ag' },
    };
    expect(isParticipantStillActive(live)).toBe(true);

    const gone = { ...live, meta: {} };
    expect(isParticipantStillActive(gone)).toBe(false);
  });

  it('answers for an llm row keyed `entity_meta.model_name`', () => {
    expect(
      isParticipantStillActive({
        id: 42,
        entity_name: 'llm',
        entity_meta: { model_name: 'gpt-4o', integration_uid: 'int-1', project_id: '1' },
      }),
    ).toBe(true);
  });

  it('is true for a dummy row', () => {
    expect(isParticipantStillActive({ id: 43, entity_name: 'dummy' })).toBe(true);
  });

  /** The `ListParticipants`-enriched user row M3 attaches: id only, name resolved into `meta.user_name`. */
  it('is false for an enriched user row — same answer as the camelCase shape', () => {
    expect(
      isParticipantStillActive({
        id: 44,
        entity_name: 'user',
        entity_meta: { id: '3' },
        meta: { user_name: 'Bob Builder' },
      }),
    ).toBe(false);
  });

  it('is false for a toolkit row', () => {
    expect(
      isParticipantStillActive({
        id: 45,
        entity_name: 'toolkit',
        entity_meta: { id: '7', project_id: '1', name: 'Jira' },
        entity_settings: { toolkit_type: 'jira' },
        meta: { name: 'Jira' },
      }),
    ).toBe(false);
  });

  /**
   * The regression guard proper: a row whose `entity_name` this table does
   * not know (or that carries none at all) must be `false`, not `undefined`.
   * The `switch` this replaced fell off its own end for exactly these, and a
   * falsy-but-not-false answer is what let the defect read as "correct".
   */
  it('returns a real `false`, never `undefined`, for an unknown or absent entity_name', () => {
    expect(isParticipantStillActive({ id: 46, entity_name: 'attachments' })).toBe(false);
    expect(isParticipantStillActive({ id: 47 })).toBe(false);
  });
});
