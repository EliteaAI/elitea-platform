import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type UseEditAgentParams, useEditAgent } from './useEditAgent';

function navBlocker(isEditingAgent = false) {
  return { isEditingAgent, setAgentEditingBlockNav: vi.fn() };
}

describe('useEditAgent', () => {
  it('opens the editor for a participant and blocks navigation', () => {
    const blocker = navBlocker();
    const { result } = renderHook(() => useEditAgent({ navBlocker: blocker }));

    result.current.onShowAgentEditor({ id: 42 });

    expect(blocker.setAgentEditingBlockNav).toHaveBeenCalledWith(true);
  });

  it('does nothing when onShowAgentEditor is called with a falsy participant', () => {
    const blocker = navBlocker();
    const { result } = renderHook(() => useEditAgent({ navBlocker: blocker }));

    // @ts-expect-error -- exercising the baseline's own defensive falsy-guard
    result.current.onShowAgentEditor(undefined);

    expect(blocker.setAgentEditingBlockNav).not.toHaveBeenCalled();
  });

  it('closes the editor and unblocks navigation', () => {
    const blocker = navBlocker();
    const { result } = renderHook(() => useEditAgent({ navBlocker: blocker }));

    result.current.onShowAgentEditor({ id: 42 });
    result.current.onCloseAgentEditor();

    expect(blocker.setAgentEditingBlockNav).toHaveBeenLastCalledWith(false);
    expect(result.current.editingAgent).toBeNull();
  });

  it('enters create mode and blocks navigation', () => {
    const blocker = navBlocker();
    const { result } = renderHook(() => useEditAgent({ navBlocker: blocker }));

    act(() => result.current.onShowAgentEditorCreator());

    expect(blocker.setAgentEditingBlockNav).toHaveBeenCalledWith(true);
    expect(result.current.isCreateMode).toBe(true);
  });

  it('switches out of create mode once the agent is created', () => {
    const blocker = navBlocker();
    const { result } = renderHook(() => useEditAgent({ navBlocker: blocker }));

    result.current.onShowAgentEditorCreator();
    result.current.onAgentEditorCreated({ id: 99 });

    expect(result.current.isCreateMode).toBe(false);
  });

  it('unblocks navigation on unmount', () => {
    const blocker = navBlocker();
    const { unmount } = renderHook(() => useEditAgent({ navBlocker: blocker }));

    unmount();

    expect(blocker.setAgentEditingBlockNav).toHaveBeenCalledWith(false);
  });

  it('handleAgentSaved does nothing when the saved agent is not the active participant', () => {
    const blocker = navBlocker();
    const setActiveParticipant = vi.fn();
    const onChangeParticipantSettings = vi.fn();
    const activeParticipant = { id: 1, entity_meta: { id: 'agent-1' } };
    const { result } = renderHook(() =>
      useEditAgent({ navBlocker: blocker, activeParticipant, setActiveParticipant, onChangeParticipantSettings }),
    );

    result.current.handleAgentSaved({ id: 'agent-2' });

    expect(setActiveParticipant).not.toHaveBeenCalled();
    expect(onChangeParticipantSettings).not.toHaveBeenCalled();
  });

  it('handleAgentSaved refreshes the active participant, syncing variables and version_id', () => {
    const blocker = navBlocker();
    const setActiveParticipant = vi.fn();
    const onChangeParticipantSettings = vi.fn();
    const activeParticipant = {
      id: 1,
      entity_meta: { id: 'agent-1' },
      entity_settings: { variables: [{ name: 'x', value: 'custom' }], version_id: 'old-version' },
    };
    const { result } = renderHook(() =>
      useEditAgent({ navBlocker: blocker, activeParticipant, setActiveParticipant, onChangeParticipantSettings }),
    );

    const savedData = {
      id: 'agent-1',
      version_details: { id: 'new-version', variables: [{ name: 'x', value: 'default' }], llm_settings: { model: 'gpt' } },
    };
    result.current.handleAgentSaved(savedData);

    expect(onChangeParticipantSettings).toHaveBeenCalledTimes(1);
    const [refreshed, persist] = onChangeParticipantSettings.mock.calls[0] as [
      { entity_settings: { variables: unknown; version_id: unknown; llm_settings: unknown } },
      boolean,
    ];
    expect(persist).toBe(true);
    expect(refreshed.entity_settings.variables).toEqual([{ name: 'x', value: 'custom' }]);
    expect(refreshed.entity_settings.version_id).toBe('new-version');
    expect(refreshed.entity_settings.llm_settings).toEqual({ model: 'gpt' });

    const updater = setActiveParticipant.mock.calls[0]?.[0] as (
      prev: { id: number } | undefined,
    ) => { id: number } | undefined;
    expect(updater({ id: 1 })).toBe(refreshed as unknown as { id: number });
    expect(updater({ id: 2 })).toEqual({ id: 2 });
  });

  it('falls back to the participant’s existing version_id when the saved version has none', () => {
    const blocker = navBlocker();
    const setActiveParticipant = vi.fn();
    const activeParticipant = {
      id: 1,
      entity_meta: { id: 'agent-1' },
      entity_settings: { variables: [], version_id: 'kept-version' },
    };
    const { result } = renderHook(() =>
      useEditAgent({ navBlocker: blocker, activeParticipant, setActiveParticipant }),
    );

    result.current.handleAgentSaved({ id: 'agent-1', version_details: {} });

    const updater = setActiveParticipant.mock.calls[0]?.[0] as (
      prev: { id: number; entity_settings: { version_id: unknown } } | undefined,
    ) => { entity_settings: { version_id: unknown } } | undefined;
    const next = updater({ id: 1, entity_settings: { version_id: 'kept-version' } });
    expect(next?.entity_settings.version_id).toBe('kept-version');
  });

  it('keeps editingAgent synced to activeParticipant while editing the same agent (not create mode)', () => {
    const blocker = navBlocker(true);
    const activeParticipant = { id: 1, name: 'v1' } as { id: number; name?: string };
    const { result, rerender } = renderHook(
      (props: UseEditAgentParams) => useEditAgent(props),
      { initialProps: { navBlocker: blocker, activeParticipant } },
    );

    result.current.onShowAgentEditor(activeParticipant);

    const updatedParticipant = { id: 1, name: 'v2' };
    rerender({ navBlocker: blocker, activeParticipant: updatedParticipant });

    expect(result.current.editingAgent).toEqual(updatedParticipant);
  });
});
