import { describe, expect, it } from 'vitest';

import { NotificationType } from './notification';

describe('NotificationType', () => {
  it('preserves the exact old-app member set (constants.js:997-1021)', () => {
    expect(Object.keys(NotificationType)).toHaveLength(23);
    expect(NotificationType.TokenExpiring).toBe('token_expiring');
    expect(NotificationType.ChatUserMentioned).toBe('chat_user_mentioned');
    expect(NotificationType.ModerationApproved).toBe('moderation_approved');
  });
});
