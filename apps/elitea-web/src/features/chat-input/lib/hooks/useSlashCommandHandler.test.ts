import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSlashCommandHandler } from './useSlashCommandHandler';
import type { SlashToolkitRef } from './useSlashCommandHandler.types';

const GITHUB: SlashToolkitRef = { id: 'tk-1', projectId: 'p-1', name: 'github', type: 'github' };
const JIRA: SlashToolkitRef = { id: 'tk-2', projectId: 'p-1', name: 'jira', type: 'jira' };

function key(k: string): { key: string; preventDefault: () => void } {
  return { key: k, preventDefault: vi.fn() };
}

describe('useSlashCommandHandler', () => {
  it('starts idle with no committed mentions', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    expect(result.current.phase).toBe('idle');
    expect(result.current.committedMentions).toEqual([]);
    expect(result.current.selectedToolkit).toBeNull();
  });

  it('onKeyDown("/") in idle opens the toolkit dropdown', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.onKeyDown(key('/') as never));
    expect(result.current.phase).toBe('toolkit');
    expect(result.current.toolkitQuery).toBe('');
    expect(result.current.isQueryFinal).toBe(false);
  });

  it('syncWithValue tracks the toolkit-only fragment while typing', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.onKeyDown(key('/') as never));
    act(() => result.current.syncWithValue('/git', 4));
    expect(result.current.phase).toBe('toolkit');
    expect(result.current.toolkitQuery).toBe('git');
  });

  it('selectToolkit advances to tool phase and eagerly commits a toolkit-only mention', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.selectToolkit(GITHUB));
    expect(result.current.phase).toBe('tool');
    expect(result.current.selectedToolkit).toEqual(GITHUB);
    expect(result.current.committedMentions).toEqual([
      { toolkitId: 'tk-1', projectId: 'p-1', toolkitName: 'github', toolkitType: 'github', toolName: null },
    ]);
  });

  it('commitMention(toolName) refines the eager toolkit-only commit in place (no duplicate entry)', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.selectToolkit(GITHUB));
    act(() => result.current.commitMention('create_issue'));
    expect(result.current.committedMentions).toEqual([
      { toolkitId: 'tk-1', projectId: 'p-1', toolkitName: 'github', toolkitType: 'github', toolName: 'create_issue' },
    ]);
    expect(result.current.phase).toBe('idle');
  });

  it('commitMention() with no toolName commits the whole toolkit and resets', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.selectToolkit(GITHUB));
    act(() => result.current.commitMention());
    expect(result.current.committedMentions).toEqual([
      { toolkitId: 'tk-1', projectId: 'p-1', toolkitName: 'github', toolkitType: 'github', toolName: null },
    ]);
    expect(result.current.phase).toBe('idle');
  });

  it('commitMention() is a no-op when no toolkit is selected', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.commitMention('x'));
    expect(result.current.committedMentions).toEqual([]);
  });

  it('selecting two different toolkits accumulates two committed mentions', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.selectToolkit(GITHUB));
    act(() => result.current.commitMention());
    act(() => result.current.selectToolkit(JIRA));
    act(() => result.current.commitMention());
    expect(result.current.committedMentions.map((m) => m.toolkitName)).toEqual(['github', 'jira']);
  });

  it('removeMention removes a mention by index', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.selectToolkit(GITHUB));
    act(() => result.current.commitMention());
    act(() => result.current.selectToolkit(JIRA));
    act(() => result.current.commitMention());
    act(() => result.current.removeMention(0));
    expect(result.current.committedMentions.map((m) => m.toolkitName)).toEqual(['jira']);
  });

  it('clearMentions empties committedMentions and calls setInputContent("")', () => {
    const setInputContent = vi.fn();
    const { result } = renderHook(() => useSlashCommandHandler({ setInputContent }));
    act(() => result.current.selectToolkit(GITHUB));
    act(() => result.current.commitMention());
    act(() => result.current.clearMentions());
    expect(result.current.committedMentions).toEqual([]);
    expect(setInputContent).toHaveBeenCalledWith('');
  });

  it('resetSlash returns to idle without touching committedMentions', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.selectToolkit(GITHUB));
    act(() => result.current.resetSlash());
    expect(result.current.phase).toBe('idle');
    expect(result.current.selectedToolkit).toBeNull();
    // The eager toolkit-only commit from selectToolkit is unaffected by resetSlash.
    expect(result.current.committedMentions).toHaveLength(1);
  });

  it('Escape resets an active mention', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.onKeyDown(key('/') as never));
    expect(result.current.phase).toBe('toolkit');
    act(() => result.current.onKeyDown(key('Escape') as never));
    expect(result.current.phase).toBe('idle');
  });

  it('a second "/" while in toolkit phase marks the query final', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.onKeyDown(key('/') as never));
    act(() => result.current.onKeyDown(key('/') as never));
    expect(result.current.isQueryFinal).toBe(true);
  });

  it('re-enters tool phase when the text still reads "/toolkitName/toolQuery" for a committed mention (idle-phase re-entry)', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.selectToolkit(GITHUB));
    act(() => result.current.commitMention());
    expect(result.current.phase).toBe('idle');

    act(() => result.current.syncWithValue('/github/creat', 13));
    expect(result.current.phase).toBe('tool');
    expect(result.current.toolQuery).toBe('creat');
    expect(result.current.selectedToolkit).toEqual(GITHUB);
    // Re-entering uncommits the mention until it is finalised again.
    expect(result.current.committedMentions).toEqual([]);
  });

  it('re-enters toolkit phase from a committed mention when the FULL name is still present (e.g. cursor placed right after it)', () => {
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.selectToolkit(GITHUB));
    act(() => result.current.commitMention());

    // cursorPos=7 places the cursor right after "/github" — the committed-mention
    // re-entry loop matches on the full name (`lastIndexOf('/github')`), NOT the
    // regex toolkit-only match.
    act(() => result.current.syncWithValue('/github', 7));
    expect(result.current.phase).toBe('toolkit');
    expect(result.current.toolkitQuery).toBe('github');
    expect(result.current.committedMentions).toEqual([]);
  });

  it('backspacing INTO a committed toolkit name (shorter than the full name) starts a fresh toolkit query and leaves the old commit untouched', () => {
    // A real, faithful baseline quirk (not a bug introduced by this port): the
    // committed-mention re-entry loop only matches the FULL committed name
    // (`lastIndexOf('/' + mention.toolkitName)`) — a partial prefix like
    // "/gith" for a no-space toolkit name like "github" never matches it, so
    // this falls through to the plain toolkit-only regex match instead, which
    // knows nothing about the previously committed mention.
    const { result } = renderHook(() => useSlashCommandHandler());
    act(() => result.current.selectToolkit(GITHUB));
    act(() => result.current.commitMention());

    act(() => result.current.syncWithValue('/gith', 5));
    expect(result.current.phase).toBe('toolkit');
    expect(result.current.toolkitQuery).toBe('gith');
    expect(result.current.committedMentions).toHaveLength(1);
  });

  describe('keyboard navigation (dropdown open)', () => {
    it('ArrowDown/ArrowUp move activeIndex, clamped within [0, itemCount)', () => {
      const { result } = renderHook(() => useSlashCommandHandler());
      act(() => result.current.onKeyDown(key('/') as never));
      result.current.itemCountRef.current = 3;

      act(() => result.current.onKeyDown(key('ArrowDown') as never));
      expect(result.current.activeIndex).toBe(1);
      act(() => result.current.onKeyDown(key('ArrowDown') as never));
      expect(result.current.activeIndex).toBe(2);
      // Clamped at the last index, does not wrap.
      act(() => result.current.onKeyDown(key('ArrowDown') as never));
      expect(result.current.activeIndex).toBe(2);

      act(() => result.current.onKeyDown(key('ArrowUp') as never));
      expect(result.current.activeIndex).toBe(1);
    });

    it('Enter invokes onConfirmActiveRef.current with the active index', () => {
      const { result } = renderHook(() => useSlashCommandHandler());
      act(() => result.current.onKeyDown(key('/') as never));
      result.current.itemCountRef.current = 2;
      const onConfirm = vi.fn();
      result.current.onConfirmActiveRef.current = onConfirm;

      act(() => result.current.onKeyDown(key('Enter') as never));
      expect(onConfirm).toHaveBeenCalledWith(0);
    });

    it('ArrowDown does nothing (no crash) when itemCountRef is 0', () => {
      const { result } = renderHook(() => useSlashCommandHandler());
      act(() => result.current.onKeyDown(key('/') as never));
      act(() => result.current.onKeyDown(key('ArrowDown') as never));
      expect(result.current.activeIndex).toBe(0);
    });
  });
});
