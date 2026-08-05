import { renderHook } from '@testing-library/react';
import type { DragEvent, RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AttachmentButtonHandle, VoiceButtonHandle } from '../../ui/NewChatInput.types';
import {
  useNewChatInputAttachmentBridge,
  useNewChatInputInputChange,
  useNewChatInputSend,
  useStopVoiceOnConversationChange,
} from './useNewChatInputController.hooks';

function dragEvent(files: readonly File[]): DragEvent<HTMLDivElement> {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { files },
  } as unknown as DragEvent<HTMLDivElement>;
}

describe('useNewChatInputSend', () => {
  it('stops the injected voice button, then forwards to onSend', () => {
    const stop = vi.fn();
    const voiceButtonRef: RefObject<VoiceButtonHandle | null> = { current: { stop } };
    const onSend = vi.fn();
    const { result } = renderHook(() => useNewChatInputSend({ voiceButtonRef, onSend }));
    result.current('q', 'ic');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('q', 'ic');
  });

  it('is a no-op-safe passthrough when no voiceButtonRef is injected', () => {
    const onSend = vi.fn();
    const { result } = renderHook(() => useNewChatInputSend({ voiceButtonRef: undefined, onSend }));
    expect(() => result.current('q', 'ic')).not.toThrow();
    expect(onSend).toHaveBeenCalledWith('q', 'ic');
  });
});

describe('useStopVoiceOnConversationChange', () => {
  it('stops the injected voice button whenever conversationId changes', () => {
    const stop = vi.fn();
    const voiceButtonRef: RefObject<VoiceButtonHandle | null> = { current: { stop } };
    const { rerender } = renderHook(({ id }: { id: string | undefined }) => useStopVoiceOnConversationChange(voiceButtonRef, id), {
      initialProps: { id: 'c1' },
    });
    expect(stop).toHaveBeenCalledTimes(1);
    rerender({ id: 'c1' });
    expect(stop).toHaveBeenCalledTimes(1);
    rerender({ id: 'c2' });
    expect(stop).toHaveBeenCalledTimes(2);
  });
});

describe('useNewChatInputInputChange', () => {
  it('forwards the value and notifies the speaking-mode loop of the manual edit', () => {
    const onInputChange = vi.fn();
    const notifyManualEdit = vi.fn();
    const { result } = renderHook(() => useNewChatInputInputChange(onInputChange, notifyManualEdit));
    result.current('hello');
    expect(onInputChange).toHaveBeenCalledWith('hello');
    expect(notifyManualEdit).toHaveBeenCalledTimes(1);
  });
});

describe('useNewChatInputAttachmentBridge', () => {
  it('delegates to the injected attachment button ref when present', () => {
    const onDrop = vi.fn();
    const attachmentButtonRef: RefObject<AttachmentButtonHandle | null> = { current: { onDrop } };
    const { result } = renderHook(() => useNewChatInputAttachmentBridge({ attachmentButtonRef, disabled: false }));
    const file = new File(['x'], 'a.txt');
    result.current.onDrop(dragEvent([file]));
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop.mock.calls[0]?.[0]).toMatchObject({ dataTransfer: { files: [file] } });

    result.current.onFilePaste(file);
    expect(onDrop).toHaveBeenCalledTimes(2);
  });

  it('silently no-ops when there is no injected ref, matching baseline (no unvalidated fallback)', () => {
    const { result } = renderHook(() =>
      useNewChatInputAttachmentBridge({ attachmentButtonRef: undefined, disabled: false }),
    );
    const file = new File(['x'], 'a.txt');
    expect(() => result.current.onDrop(dragEvent([file]))).not.toThrow();
    expect(() => result.current.onFilePaste([file])).not.toThrow();
  });

  it('no-ops (does not call the ref) while disabled', () => {
    const onDrop = vi.fn();
    const attachmentButtonRef: RefObject<AttachmentButtonHandle | null> = { current: { onDrop } };
    const { result } = renderHook(() => useNewChatInputAttachmentBridge({ attachmentButtonRef, disabled: true }));
    result.current.onDrop(dragEvent([new File(['x'], 'a.txt')]));
    expect(onDrop).not.toHaveBeenCalled();
  });
});
