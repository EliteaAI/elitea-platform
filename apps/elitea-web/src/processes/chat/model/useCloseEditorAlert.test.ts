import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCloseEditorAlert } from './useCloseEditorAlert';
import type { UseCloseEditorAlertParams } from './useCloseEditorAlert';

function buildParams(overrides: Partial<UseCloseEditorAlertParams<unknown, unknown>> = {}): UseCloseEditorAlertParams<unknown, unknown> {
  return {
    editorType: 'agent',
    isEditorOpen: false,
    onCloseEditor: vi.fn(),
    onSelectParticipant: vi.fn(),
    onSelectConversation: vi.fn(),
    onSelectThisParticipant: vi.fn(),
    isStreaming: false,
    setIsStreaming: vi.fn(),
    boxRef: { current: { stopAll: vi.fn() } },
    ...overrides,
  };
}

describe('useCloseEditorAlert', () => {
  it('selects the participant directly when the editor is closed and nothing is streaming', () => {
    const params = buildParams();
    const { result } = renderHook(() => useCloseEditorAlert(params));

    act(() => result.current.onHandleSelectParticipant({ id: 'p1' }));

    expect(params.onSelectParticipant).toHaveBeenCalledWith({ id: 'p1' }, true);
    expect(result.current.openAlert).toBe(false);
  });

  it('raises the alert instead of selecting when the editor is open', () => {
    const params = buildParams({ isEditorOpen: true });
    const { result } = renderHook(() => useCloseEditorAlert(params));

    act(() => result.current.onHandleSelectParticipant({ id: 'p1' }, false));

    expect(params.onSelectParticipant).not.toHaveBeenCalled();
    expect(result.current.openAlert).toBe(true);
    expect(result.current.alertContent).toContain('discard current changes');
  });

  it('confirming after an editor-open alert closes the editor then runs the queued select', () => {
    const params = buildParams({ isEditorOpen: true });
    const { result } = renderHook(() => useCloseEditorAlert(params));

    act(() => result.current.onHandleSelectParticipant({ id: 'p1' }));
    act(() => result.current.onConfirmOperation());

    expect(params.onCloseEditor).toHaveBeenCalledTimes(1);
    expect(params.onSelectParticipant).toHaveBeenCalledWith({ id: 'p1' }, true);
    expect(result.current.openAlert).toBe(false);
  });

  it('cancelling drops the queued operation', () => {
    const params = buildParams({ isEditorOpen: true });
    const { result } = renderHook(() => useCloseEditorAlert(params));

    act(() => result.current.onHandleSelectThisParticipant({ id: 'p1' }));
    act(() => result.current.onCancelOperation());
    act(() => result.current.onConfirmOperation());

    expect(params.onSelectThisParticipant).not.toHaveBeenCalled();
  });

  it('conversation switch while streaming (editor closed) shows the streaming warning and stops the box on confirm', () => {
    const params = buildParams({ isStreaming: true });
    const { result } = renderHook(() => useCloseEditorAlert(params));

    act(() => result.current.onHandleSelectConversation({ id: 'c1' }));
    expect(result.current.alertContent).toContain('still generating');

    act(() => result.current.onConfirmOperation());
    expect(params.boxRef.current?.stopAll).toHaveBeenCalledTimes(1);
    expect(params.setIsStreaming).toHaveBeenCalledWith(false);
    expect(params.onSelectConversation).toHaveBeenCalledWith({ id: 'c1' });
  });

  it('conversation switch with neither editor open nor streaming selects immediately', () => {
    const params = buildParams();
    const { result } = renderHook(() => useCloseEditorAlert(params));

    act(() => result.current.onHandleSelectConversation({ id: 'c1' }));

    expect(params.onSelectConversation).toHaveBeenCalledWith({ id: 'c1' });
    expect(result.current.openAlert).toBe(false);
  });

  it('selects this-participant directly when the editor is closed', () => {
    const params = buildParams();
    const { result } = renderHook(() => useCloseEditorAlert(params));

    act(() => result.current.onHandleSelectThisParticipant({ id: 'p2' }));

    expect(params.onSelectThisParticipant).toHaveBeenCalledWith({ id: 'p2' });
  });

  it('setOpenAlert is exposed for direct control', () => {
    const params = buildParams();
    const { result } = renderHook(() => useCloseEditorAlert(params));

    act(() => result.current.setOpenAlert(true));
    expect(result.current.openAlert).toBe(true);
  });

  it('conversation switch while the editor is open (not streaming) raises the editor alert and queues the select', () => {
    const params = buildParams({ isEditorOpen: true, isStreaming: true });
    const { result } = renderHook(() => useCloseEditorAlert(params));

    act(() => result.current.onHandleSelectConversation({ id: 'c1' }));
    expect(result.current.alertContent).toContain('discard current changes');
    expect(params.onSelectConversation).not.toHaveBeenCalled();

    act(() => result.current.onConfirmOperation());
    expect(params.onCloseEditor).toHaveBeenCalledTimes(1);
    expect(params.onSelectConversation).toHaveBeenCalledWith({ id: 'c1' });
    // The editor-open branch queues the select directly (no stopAll/setIsStreaming
    // call) — this is a separate code path from the isStreaming-only branch.
    expect(params.boxRef.current?.stopAll).not.toHaveBeenCalled();
    expect(params.setIsStreaming).not.toHaveBeenCalled();
  });

  it.each([
    ['canvas', 'editing canvas now'],
    ['toolkit', 'editing toolkit now'],
    ['mcp', 'editing MCP now'],
    ['artifact', 'editing artifact now'],
    ['editor', 'editing now'],
  ] as const)('getEditorWarning: editorType %s produces its own warning text', (editorType, expectedSubstring) => {
    const params = buildParams({ editorType, isEditorOpen: true });
    const { result } = renderHook(() => useCloseEditorAlert(params));

    act(() => result.current.onHandleSelectThisParticipant({ id: 'p1' }));
    expect(result.current.alertContent).toContain(expectedSubstring);
  });
});
