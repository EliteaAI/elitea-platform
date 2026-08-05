import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useInstructionsSlashCommand } from './useInstructionsSlashCommand.hooks';

describe('useInstructionsSlashCommand', () => {
  it('starts idle with no query and no committed mentions', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    expect(result.current.phase).toBe('idle');
    expect(result.current.committedMentions).toStrictEqual([]);
  });

  it('enters the items phase on "/" keydown and records the anchor position', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => {
      result.current.onKeyDown({ key: '/', target: { selectionStart: 5 } });
    });
    expect(result.current.phase).toBe('items');
    expect(result.current.mentionAnchorRef.current).toBe(5);
  });

  it('Escape from a non-idle phase resets to idle', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => result.current.onKeyDown({ key: '/', target: {} }));
    expect(result.current.phase).toBe('items');
    act(() => result.current.onKeyDown({ key: 'Escape', target: {} }));
    expect(result.current.phase).toBe('idle');
  });

  it('syncWithValue narrows itemQuery as the user types after "/"', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => result.current.onKeyDown({ key: '/', target: { selectionStart: 0 } }));
    act(() => result.current.syncWithValue('/Git', 4));
    expect(result.current.itemQuery).toBe('Git');
  });

  it('selecting a non-toolkit item commits the mention directly and returns to idle', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => result.current.selectItem({ name: 'MyAgent' }, false));
    expect(result.current.phase).toBe('idle');
    expect(result.current.committedMentions).toStrictEqual([{ name: 'MyAgent', tool_name: null }]);
  });

  it('selecting a toolkit item advances to the tools phase without committing yet', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => result.current.selectItem({ name: 'Github' }, true));
    expect(result.current.phase).toBe('tools');
    expect(result.current.selectedItem).toStrictEqual({ name: 'Github' });
    // The toolkit name itself is pre-committed (tool_name: null) so it survives even if the
    // user abandons tool selection.
    expect(result.current.committedMentions).toStrictEqual([{ name: 'Github', tool_name: null }]);
  });

  it('commitMention with a tool name adds a SEPARATE {name, tool_name} entry alongside the toolkit-only one (each distinct pair is its own committed mention, matching the baseline)', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => result.current.selectItem({ name: 'Github' }, true));
    act(() => result.current.commitMention('create_issue'));
    expect(result.current.phase).toBe('idle');
    expect(result.current.committedMentions).toStrictEqual([
      { name: 'Github', tool_name: null },
      { name: 'Github', tool_name: 'create_issue' },
    ]);
  });

  it('commitMention with no toolName commits the toolkit-only entry and is a no-op without a selected item', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => result.current.commitMention('x'));
    expect(result.current.committedMentions).toStrictEqual([]);
  });

  it('resetAll clears both the in-progress mention state and every committed mention', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => result.current.selectItem({ name: 'MyAgent' }, false));
    expect(result.current.committedMentions).toHaveLength(1);
    act(() => result.current.resetAll());
    expect(result.current.committedMentions).toStrictEqual([]);
    expect(result.current.phase).toBe('idle');
  });

  it('initCommittedMentions seeds committed mentions without touching the active phase', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => result.current.initCommittedMentions([{ name: 'Seeded', tool_name: null }]));
    expect(result.current.committedMentions).toStrictEqual([{ name: 'Seeded', tool_name: null }]);
    expect(result.current.phase).toBe('idle');
  });

  it('backspacing into a committed mention re-opens the items phase (idle -> items detection)', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => result.current.initCommittedMentions([{ name: 'MyAgent', tool_name: null }]));
    // Text still contains the full committed token; cursor placed right after it simulates
    // the user having just backspaced the trailing space.
    act(() => result.current.syncWithValue('/MyAgent', 8));
    expect(result.current.phase).toBe('items');
    expect(result.current.itemQuery).toBe('MyAgent');
    expect(result.current.committedMentions).toStrictEqual([]);
  });

  it('resetSlash on Enter/whitespace-completed mention leaves committed mentions intact', () => {
    const { result } = renderHook(() => useInstructionsSlashCommand());
    act(() => result.current.onKeyDown({ key: '/', target: { selectionStart: 0 } }));
    act(() => result.current.syncWithValue('/A ', 3));
    expect(result.current.phase).toBe('idle');
  });
});
