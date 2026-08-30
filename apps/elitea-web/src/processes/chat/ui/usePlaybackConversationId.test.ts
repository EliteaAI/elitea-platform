import { describe, expect, it } from 'vitest';

import { playbackConversationId } from './usePlaybackConversationId';

describe('playbackConversationId', () => {
  it('names the conversation when the flag is set and a conversation is open', () => {
    expect(playbackConversationId('1', 'c-1')).toBe('c-1');
  });

  it('names nothing when the flag is absent', () => {
    expect(playbackConversationId(undefined, 'c-1')).toBeUndefined();
  });

  it('names nothing for the flag default', () => {
    expect(playbackConversationId('0', 'c-1')).toBeUndefined();
  });

  /*
   * `?playback=1` on bare `/chat` names nothing to replay. Without this
   * branch the playback surface would render an empty box in place of the
   * chat the user actually asked for.
   */
  it('names nothing on bare /chat, where no conversation is open', () => {
    expect(playbackConversationId('1', undefined)).toBeUndefined();
    expect(playbackConversationId('1', '')).toBeUndefined();
  });
});
