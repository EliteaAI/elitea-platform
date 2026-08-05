import { describe, expect, it } from 'vitest';

import { selectEditedParticipantId } from './useEditedParticipantId';

describe('selectEditedParticipantId', () => {
  it('returns undefined for a non-object search', () => {
    expect(selectEditedParticipantId(undefined)).toBeUndefined();
    expect(selectEditedParticipantId(null)).toBeUndefined();
    expect(selectEditedParticipantId('nope')).toBeUndefined();
  });

  it('returns undefined when the param is absent or not a string', () => {
    expect(selectEditedParticipantId({})).toBeUndefined();
    expect(selectEditedParticipantId({ edited_participant_id: 42 })).toBeUndefined();
  });

  it('returns the string value when present', () => {
    expect(selectEditedParticipantId({ edited_participant_id: 'p-1' })).toBe('p-1');
  });
});
