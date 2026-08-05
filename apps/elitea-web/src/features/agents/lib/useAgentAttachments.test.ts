import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAgentAttachments } from './useAgentAttachments';

function file(name: string): File {
  return new File(['content'], name, { type: 'text/plain' });
}

describe('useAgentAttachments', () => {
  it('disableAttachments is true when internal_tools omits "attachments"', () => {
    const { result } = renderHook(() => useAgentAttachments({ internalTools: ['internal_mcp'], versionId: 1 }));
    expect(result.current.disableAttachments).toBe(true);
  });

  it('disableAttachments is false when internal_tools includes "attachments"', () => {
    const { result } = renderHook(() =>
      useAgentAttachments({ internalTools: ['internal_mcp', 'attachments'], versionId: 1 }),
    );
    expect(result.current.disableAttachments).toBe(false);
  });

  it('adds and deletes attachments when enabled', () => {
    const { result } = renderHook(() =>
      useAgentAttachments({ internalTools: ['attachments'], versionId: 1 }),
    );

    act(() => result.current.onAttachFiles([file('a.txt'), file('b.txt')]));
    expect(result.current.attachments.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);

    act(() => result.current.onDeleteAttachment(0));
    expect(result.current.attachments.map((f) => f.name)).toEqual(['b.txt']);
  });

  it('clears attachments as soon as attachments become disabled', () => {
    const { result, rerender } = renderHook(
      ({ internalTools }: { internalTools: readonly string[] }) => useAgentAttachments({ internalTools, versionId: 1 }),
      { initialProps: { internalTools: ['attachments'] } },
    );

    act(() => result.current.onAttachFiles([file('a.txt')]));
    expect(result.current.attachments).toHaveLength(1);

    rerender({ internalTools: ['internal_mcp'] });
    expect(result.current.attachments).toHaveLength(0);
    expect(result.current.disableAttachments).toBe(true);
  });

  it('clears attachments when versionId changes', () => {
    const { result, rerender } = renderHook(
      ({ versionId }: { versionId: number }) => useAgentAttachments({ internalTools: ['attachments'], versionId }),
      { initialProps: { versionId: 1 } },
    );

    act(() => result.current.onAttachFiles([file('a.txt')]));
    expect(result.current.attachments).toHaveLength(1);

    rerender({ versionId: 2 });
    expect(result.current.attachments).toHaveLength(0);
  });

  it('onClearAttachments empties the list directly', () => {
    const { result } = renderHook(() => useAgentAttachments({ internalTools: ['attachments'], versionId: 1 }));
    act(() => result.current.onAttachFiles([file('a.txt')]));
    act(() => result.current.onClearAttachments());
    expect(result.current.attachments).toHaveLength(0);
  });
});
