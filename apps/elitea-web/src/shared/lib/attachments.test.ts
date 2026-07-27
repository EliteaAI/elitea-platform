import { describe, expect, it } from 'vitest';

import { ATTACHMENT_LIMITS } from './attachments';

describe('ATTACHMENT_LIMITS', () => {
  it('preserves the exact byte/count limits (constants.js:1059-1065)', () => {
    expect(ATTACHMENT_LIMITS.MAX_ATTACHMENTS).toBe(10);
    expect(ATTACHMENT_LIMITS.MAX_TOTAL_SIZE).toBe(150 * 1024 * 1024);
    expect(ATTACHMENT_LIMITS.DEFAULT_MAX_FILE_SIZE).toBe(157_286_400);
    expect(ATTACHMENT_LIMITS.MAX_IMAGE_ATTACHMENTS).toBe(10);
    expect(ATTACHMENT_LIMITS.MAX_IMAGE_FILE_SIZE).toBe(5 * 1024 * 1024);
  });
});
