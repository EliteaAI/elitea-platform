import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useInstructionsTildaCommand } from './useInstructionsTildaCommand.hooks';

describe('useInstructionsTildaCommand', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useInstructionsTildaCommand());
    expect(result.current.phase).toBe('idle');
    expect(result.current.committedMentions).toStrictEqual([]);
  });

  it('enters the items phase on "~" keydown', () => {
    const { result } = renderHook(() => useInstructionsTildaCommand());
    act(() => result.current.onKeyDown({ key: '~', target: { selectionStart: 2 } }));
    expect(result.current.phase).toBe('items');
    expect(result.current.mentionAnchorRef.current).toBe(2);
  });

  it('Escape resets to idle from the items phase', () => {
    const { result } = renderHook(() => useInstructionsTildaCommand());
    act(() => result.current.onKeyDown({ key: '~', target: {} }));
    act(() => result.current.onKeyDown({ key: 'Escape', target: {} }));
    expect(result.current.phase).toBe('idle');
  });

  it('syncWithValue narrows itemQuery as the user types after "~"', () => {
    const { result } = renderHook(() => useInstructionsTildaCommand());
    act(() => result.current.onKeyDown({ key: '~', target: { selectionStart: 0 } }));
    act(() => result.current.syncWithValue('~pdf-ex', 7));
    expect(result.current.itemQuery).toBe('pdf-ex');
  });

  it('a non-matching sync (whitespace after the trigger) resets to idle', () => {
    const { result } = renderHook(() => useInstructionsTildaCommand());
    act(() => result.current.onKeyDown({ key: '~', target: { selectionStart: 0 } }));
    act(() => result.current.syncWithValue('~pdf ', 5));
    expect(result.current.phase).toBe('idle');
  });

  it('selectItem commits the mention and returns to idle', () => {
    const { result } = renderHook(() => useInstructionsTildaCommand());
    act(() => result.current.selectItem({ name: 'pdf-extractor' }));
    expect(result.current.phase).toBe('idle');
    expect(result.current.committedMentions).toStrictEqual([{ name: 'pdf-extractor', tool_name: null }]);
  });

  it('does not commit a duplicate mention of the same name', () => {
    const { result } = renderHook(() => useInstructionsTildaCommand());
    act(() => result.current.selectItem({ name: 'pdf-extractor' }));
    act(() => result.current.selectItem({ name: 'pdf-extractor' }));
    expect(result.current.committedMentions).toStrictEqual([{ name: 'pdf-extractor', tool_name: null }]);
  });

  it('initCommittedMentions seeds committed mentions', () => {
    const { result } = renderHook(() => useInstructionsTildaCommand());
    act(() => result.current.initCommittedMentions([{ name: 'seeded', tool_name: null }]));
    expect(result.current.committedMentions).toStrictEqual([{ name: 'seeded', tool_name: null }]);
  });

  it('backspacing into a committed mention re-opens the items phase', () => {
    const { result } = renderHook(() => useInstructionsTildaCommand());
    act(() => result.current.initCommittedMentions([{ name: 'pdf-extractor', tool_name: null }]));
    act(() => result.current.syncWithValue('~pdf-extractor', 14));
    expect(result.current.phase).toBe('items');
    expect(result.current.itemQuery).toBe('pdf-extractor');
    expect(result.current.committedMentions).toStrictEqual([]);
  });
});
