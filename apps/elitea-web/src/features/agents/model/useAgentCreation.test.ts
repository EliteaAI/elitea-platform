import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type AddedParticipantLike, useAgentCreation } from './useAgentCreation';

describe('useAgentCreation', () => {
  it('does nothing when result is falsy', async () => {
    const onAgentEditorCreated = vi.fn();
    const addNewParticipants = vi.fn();
    const onSetActiveParticipant = vi.fn();
    const { result } = renderHook(() =>
      useAgentCreation({ onAgentEditorCreated, addNewParticipants, onSetActiveParticipant }),
    );

    await result.current.onAgentCreated(undefined);

    expect(onAgentEditorCreated).not.toHaveBeenCalled();
    expect(addNewParticipants).not.toHaveBeenCalled();
  });

  it('transforms the created agent into participant shape and opens the editor onto it', async () => {
    const onAgentEditorCreated = vi.fn();
    const addNewParticipants = vi.fn().mockResolvedValue(undefined);
    const onSetActiveParticipant = vi.fn();
    const { result } = renderHook(() =>
      useAgentCreation({ onAgentEditorCreated, addNewParticipants, onSetActiveParticipant }),
    );

    await result.current.onAgentCreated({
      id: 42,
      name: 'My Agent',
      project_id: 'proj-1',
      version_details: { id: 7, variables: [{ name: 'x' }], meta: { icon_meta: { url: 'x' } } },
    });

    expect(onAgentEditorCreated).toHaveBeenCalledWith({
      entity_meta: { id: 42, name: 'My Agent', project_id: 'proj-1' },
      entity_settings: { version_id: 7, variables: [{ name: 'x' }], icon_meta: { url: 'x' } },
      meta: { name: 'My Agent' },
      name: 'My Agent',
    });
    expect(addNewParticipants).toHaveBeenCalledTimes(1);
    const [participants] = addNewParticipants.mock.calls[0] as [unknown[]];
    expect(participants).toEqual([{ participantType: 'application', id: 42, name: 'My Agent', project_id: 'proj-1', version_details: { id: 7, variables: [{ name: 'x' }], meta: { icon_meta: { url: 'x' } } } }]);
  });

  it('auto-activates the newly created agent among the added participants', async () => {
    const onAgentEditorCreated = vi.fn();
    const onSetActiveParticipant = vi.fn();
    const addNewParticipants = vi.fn((_participants, onAdded: (added: readonly AddedParticipantLike[]) => void) => {
      onAdded([
        { entity_name: 'toolkit', entity_meta: { id: 1 } },
        { entity_name: 'application', entity_meta: { id: 42 } },
      ]);
      return Promise.resolve();
    });
    const { result } = renderHook(() =>
      useAgentCreation({ onAgentEditorCreated, addNewParticipants, onSetActiveParticipant }),
    );

    await result.current.onAgentCreated({ id: 42, name: 'My Agent' });

    expect(onSetActiveParticipant).toHaveBeenCalledWith({ entity_name: 'application', entity_meta: { id: 42 } });
  });

  it('does not activate anything when the created agent is not among the added participants', async () => {
    const onAgentEditorCreated = vi.fn();
    const onSetActiveParticipant = vi.fn();
    const addNewParticipants = vi.fn((_participants, onAdded: (added: readonly AddedParticipantLike[]) => void) => {
      onAdded([{ entity_name: 'toolkit', entity_meta: { id: 1 } }]);
      return Promise.resolve();
    });
    const { result } = renderHook(() =>
      useAgentCreation({ onAgentEditorCreated, addNewParticipants, onSetActiveParticipant }),
    );

    await result.current.onAgentCreated({ id: 42, name: 'My Agent' });

    expect(onSetActiveParticipant).not.toHaveBeenCalled();
  });

  it('logs and swallows a failure adding the participant', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onAgentEditorCreated = vi.fn();
    const onSetActiveParticipant = vi.fn();
    const addNewParticipants = vi.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() =>
      useAgentCreation({ onAgentEditorCreated, addNewParticipants, onSetActiveParticipant }),
    );

    await result.current.onAgentCreated({ id: 42, name: 'My Agent' });

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    consoleError.mockRestore();
  });
});
