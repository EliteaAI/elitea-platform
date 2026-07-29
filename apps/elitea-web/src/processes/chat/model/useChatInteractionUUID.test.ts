import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useChatInteractionUUID } from './useChatInteractionUUID';

const UUID_RE = /^[0-9a-f-]{36}$/i;

describe('useChatInteractionUUID', () => {
  it('stays empty until a conversation id is present', () => {
    const { result } = renderHook(() => useChatInteractionUUID(undefined));
    expect(result.current).toBe('');
  });

  it('generates a uuid once a conversation id is set', async () => {
    const { result, rerender } = renderHook<string, { id: string | undefined }>(({ id }) => useChatInteractionUUID(id), {
      initialProps: { id: undefined },
    });
    expect(result.current).toBe('');

    rerender({ id: 'conv-1' });
    await act(async () => {});
    expect(result.current).toMatch(UUID_RE);
  });

  it('regenerates a new uuid when the conversation id changes', async () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useChatInteractionUUID(id), {
      initialProps: { id: 'conv-1' },
    });
    await act(async () => {});
    const first = result.current;

    rerender({ id: 'conv-2' });
    await act(async () => {});
    expect(result.current).toMatch(UUID_RE);
    expect(result.current).not.toBe(first);
  });
});
