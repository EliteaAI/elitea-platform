import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useToolkitCreation } from './useToolkitCreation';
import type { ToolkitCreationResult } from './useToolkitCreation';

describe('useToolkitCreation', () => {
  it('is a no-op when result is falsy', async () => {
    const onToolkitEditorCreated = vi.fn();
    const addNewParticipants = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useToolkitCreation({ onToolkitEditorCreated, addNewParticipants }));

    await result.current.onToolkitCreated(undefined);

    expect(onToolkitEditorCreated).not.toHaveBeenCalled();
    expect(addNewParticipants).not.toHaveBeenCalled();
  });

  it('transforms the created toolkit into the editor participant shape and notifies the editor first', async () => {
    const onToolkitEditorCreated = vi.fn();
    const addNewParticipants = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useToolkitCreation({ onToolkitEditorCreated, addNewParticipants }));

    const created: ToolkitCreationResult = {
      id: 'tk-1',
      name: 'My GitHub',
      project_id: 'proj-1',
      version_details: { id: 'v1', variables: [{ name: 'x' }], meta: { icon_meta: { kind: 'brand' } } },
    };

    await result.current.onToolkitCreated(created);

    expect(onToolkitEditorCreated).toHaveBeenCalledWith({
      entity_meta: { id: 'tk-1', name: 'My GitHub', project_id: 'proj-1' },
      entity_settings: { version_id: 'v1', variables: [{ name: 'x' }], icon_meta: { kind: 'brand' } },
      meta: { name: 'My GitHub', mcp: false },
      name: 'My GitHub',
    });
  });

  it('adds the created toolkit as a Toolkits-typed participant', async () => {
    const onToolkitEditorCreated = vi.fn();
    const addNewParticipants = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useToolkitCreation({ onToolkitEditorCreated, addNewParticipants }));

    const created: ToolkitCreationResult = { id: 'tk-1', name: 'My GitHub', is_mcp: true };

    await result.current.onToolkitCreated(created);

    expect(addNewParticipants).toHaveBeenCalledWith([{ participantType: 'toolkit', id: 'tk-1', name: 'My GitHub', is_mcp: true }]);
  });

  it('defaults meta.mcp to false and version fields to safe fallbacks when version_details is absent', async () => {
    const onToolkitEditorCreated = vi.fn();
    const addNewParticipants = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useToolkitCreation({ onToolkitEditorCreated, addNewParticipants }));

    await result.current.onToolkitCreated({ id: 'tk-2', name: 'Plain' });

    expect(onToolkitEditorCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_settings: { version_id: undefined, variables: [], icon_meta: undefined },
        meta: { name: 'Plain', mcp: false },
      }),
    );
  });
});
