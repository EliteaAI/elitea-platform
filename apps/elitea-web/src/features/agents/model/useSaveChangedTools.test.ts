import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AgentToolAssociation } from '../lib/types';

import { getChangedTools, useSaveChangedTools } from './useSaveChangedTools';

function tool(id: string, selected: readonly string[]): AgentToolAssociation {
  return { id, type: 'toolkit', settings: { selected_tools: selected } };
}

describe('getChangedTools', () => {
  it('returns [] when nothing changed', () => {
    const current = [tool('a', ['x', 'y'])];
    const original = [tool('a', ['x', 'y'])];
    expect(getChangedTools(current, original)).toEqual([]);
  });

  it('detects an added selected tool', () => {
    const current = [tool('a', ['x', 'y'])];
    const original = [tool('a', ['x'])];
    const changed = getChangedTools(current, original);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ index: 0, toolId: 'a', currentSelectedTools: ['x', 'y'], originalSelectedTools: ['x'] });
  });

  it('detects a removed selected tool', () => {
    const current = [tool('a', ['x'])];
    const original = [tool('a', ['x', 'y'])];
    expect(getChangedTools(current, original)).toHaveLength(1);
  });

  it('detects a same-length reordering-free swap (different set, same size)', () => {
    const current = [tool('a', ['x', 'z'])];
    const original = [tool('a', ['x', 'y'])];
    expect(getChangedTools(current, original)).toHaveLength(1);
  });

  it('ignores an index with no matching original entry (array grew)', () => {
    const current = [tool('a', ['x']), tool('b', ['z'])];
    const original = [tool('a', ['x'])];
    expect(getChangedTools(current, original)).toEqual([]);
  });

  it('treats a tool with no settings.selected_tools as an empty selection', () => {
    const current = [{ id: 'a', type: 'toolkit' }];
    const original = [tool('a', ['x'])];
    expect(getChangedTools(current, original)).toHaveLength(1);
  });

  it('defaults both arguments to [] and returns []', () => {
    expect(getChangedTools()).toEqual([]);
  });
});

describe('useSaveChangedTools', () => {
  it('onSaveTools resolves true when nothing changed', async () => {
    const same = [tool('a', ['x'])];
    const { result } = renderHook(() => useSaveChangedTools(same, same));
    expect(result.current.changedTools).toEqual([]);

    let resolved: boolean | undefined;
    await act(async () => {
      resolved = await result.current.onSaveTools();
    });
    expect(resolved).toBe(true);
    expect(result.current.unsavedTools).toEqual([]);
    expect(result.current.isSavingToolkit).toBe(false);
  });

  it('onSaveTools resolves false (never silently succeeds) and surfaces unsavedTools when something changed — the real backend gap', async () => {
    const current = [tool('a', ['x', 'y'])];
    const original = [tool('a', ['x'])];
    const { result } = renderHook(() => useSaveChangedTools(current, original));
    expect(result.current.changedTools).toHaveLength(1);

    let resolved: boolean | undefined;
    await act(async () => {
      resolved = await result.current.onSaveTools();
    });
    expect(resolved).toBe(false);
    expect(result.current.unsavedTools).toHaveLength(1);
    await waitFor(() => expect(result.current.isSavingToolkit).toBe(false));
  });

  it('treats undefined currentTools/originalTools the same as empty arrays', () => {
    const { result } = renderHook(() => useSaveChangedTools(undefined, undefined));
    expect(result.current.changedTools).toEqual([]);
  });
});
