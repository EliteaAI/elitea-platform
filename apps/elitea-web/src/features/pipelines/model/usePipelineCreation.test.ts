import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePipelineCreation } from './usePipelineCreation';

describe('usePipelineCreation', () => {
  it('is a no-op when the created pipeline is undefined', () => {
    const onPipelineEditorCreated = vi.fn();
    const addNewParticipants = vi.fn();
    const onSetActiveParticipant = vi.fn();
    const { result } = renderHook(() =>
      usePipelineCreation({ onPipelineEditorCreated, addNewParticipants, onSetActiveParticipant }),
    );

    result.current.onPipelineCreated(undefined);

    expect(onPipelineEditorCreated).not.toHaveBeenCalled();
    expect(addNewParticipants).not.toHaveBeenCalled();
    expect(onSetActiveParticipant).not.toHaveBeenCalled();
  });

  it('builds a pipeline chat participant and calls addNewParticipants/onSetActiveParticipant/onPipelineEditorCreated with it', () => {
    const onPipelineEditorCreated = vi.fn();
    const addNewParticipants = vi.fn();
    const onSetActiveParticipant = vi.fn();
    const { result } = renderHook(() =>
      usePipelineCreation({ onPipelineEditorCreated, addNewParticipants, onSetActiveParticipant }),
    );

    result.current.onPipelineCreated({
      id: 42,
      name: 'My Pipeline',
      version_details: { id: 7 },
    });

    const expectedParticipant = {
      id: 42,
      name: 'My Pipeline',
      version_details: { id: 7 },
      participantType: 'pipeline',
      entity_name: 'application',
      entity_meta: { id: 42 },
      meta: { name: 'My Pipeline' },
      entity_settings: { agent_type: 'pipeline', version_id: 7 },
    };

    expect(addNewParticipants).toHaveBeenCalledWith([expectedParticipant]);
    expect(onSetActiveParticipant).toHaveBeenCalledWith(expectedParticipant);
    expect(onPipelineEditorCreated).toHaveBeenCalledWith(expectedParticipant);
  });

  it('tolerates all three callbacks being absent', () => {
    const { result } = renderHook(() => usePipelineCreation({}));

    expect(() => result.current.onPipelineCreated({ id: 1, name: 'p' })).not.toThrow();
  });
});
