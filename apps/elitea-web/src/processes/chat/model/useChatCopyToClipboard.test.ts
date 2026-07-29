import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatCopyToClipboard } from './useChatCopyToClipboard';
import type { CopyableChatMessage } from './useChatCopyToClipboard';

const HISTORY: readonly CopyableChatMessage[] = [
  { id: 1, content: 'plain text' },
  { id: 2, message_items: [{ content: 'first' }, { item_details: { content: 'second' } }, { content: '' }] },
  { id: 3, exception: { message: 'boom' } },
  { id: 4 },
];

describe('useChatCopyToClipboard', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('copies plain content and resolves true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { result } = renderHook(() => useChatCopyToClipboard(HISTORY));
    await expect(result.current(1)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('plain text');
  });

  it('joins message_items content, skipping empties', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { result } = renderHook(() => useChatCopyToClipboard(HISTORY));
    await result.current(2);
    expect(writeText).toHaveBeenCalledWith('first\nsecond');
  });

  it('stringifies the exception when present', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { result } = renderHook(() => useChatCopyToClipboard(HISTORY));
    await result.current(3);
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ message: 'boom' }));
  });

  it('resolves false when the message id is not found', async () => {
    const { result } = renderHook(() => useChatCopyToClipboard(HISTORY));
    await expect(result.current(999)).resolves.toBe(false);
  });

  it('resolves false for a message with no content/exception/message_items', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { result } = renderHook(() => useChatCopyToClipboard(HISTORY));
    await expect(result.current(4)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('');
  });

  it('resolves false when chatHistory is undefined', async () => {
    const { result } = renderHook(() => useChatCopyToClipboard(undefined));
    await expect(result.current(1)).resolves.toBe(false);
  });
});
