import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleCopy } from './clipboard';

describe('handleCopy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('resolves via the Clipboard API when supported', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await expect(handleCopy('hello')).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('falls back to execCommand when the Clipboard API is unsupported', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    await expect(handleCopy('fallback text')).resolves.toBeUndefined();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when the Clipboard API write rejects', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    await expect(handleCopy('x')).resolves.toBeUndefined();
    expect(execCommand).toHaveBeenCalled();
  });

  it('rejects the textarea fallback (and falls through to the outer catch) when DOM manipulation throws', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const created = vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('DOM unavailable');
    });

    // Clipboard is undefined, so the outer catch's fire-and-forget call
    // dereferences it and rejects synchronously (same quirk as below) —
    // this test's point is only to exercise legacyCopyViaTextarea's own
    // internal catch/reject path.
    await expect(handleCopy('boom')).rejects.toThrow();
    created.mockRestore();
  });

  it('cleans up the temporary textarea used by the execCommand fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(true), configurable: true });

    await handleCopy('cleanup-check');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it(
    'preserved quirk (N4): when both the primary write and the textarea fallback ' +
      'fail, the outer catch fire-and-forgets a SECOND clipboard write without ' +
      'awaiting or catching it',
    async () => {
      const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true });

      await expect(handleCopy('y')).resolves.toBeUndefined();
      expect(writeText).toHaveBeenCalledTimes(2);
    },
  );

  it(
    'preserved quirk (N4): when the Clipboard API is unsupported AND the textarea ' +
      'fallback fails, the catch-block fallback dereferences a nonexistent ' +
      'navigator.clipboard and handleCopy REJECTS rather than resolving',
    async () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true });

      await expect(handleCopy('z')).rejects.toThrow();
    },
  );
});
