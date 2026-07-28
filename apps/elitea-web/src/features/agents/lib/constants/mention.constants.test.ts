import { describe, expect, it } from 'vitest';

import { MentionPhase, SKILL_TRIGGER, SLASH_TRIGGER } from './mention.constants';

describe('mention.constants', () => {
  it('carries the three mention-machine phases byte-for-byte from the baseline', () => {
    expect(MentionPhase).toStrictEqual({ Idle: 'idle', Items: 'items', Tools: 'tools' });
  });

  it('carries the two trigger characters', () => {
    expect(SLASH_TRIGGER).toBe('/');
    expect(SKILL_TRIGGER).toBe('~');
  });
});
