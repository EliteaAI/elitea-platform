import { describe, expect, it, vi } from 'vitest';

import type { Participant } from '@/entities/participant';

import { buildAgentEditorProps } from './ChatBox.helpers';

const PARTICIPANT: Participant = { id: '1', entityName: 'application' };

function baseParams() {
  return {
    participantForEditor: PARTICIPANT,
    activeParticipantDetails: undefined,
    isAgentsPage: false,
    selectSavedOrDefaultModel: undefined,
    onShowParticipantsList: undefined,
    onSelectVersion: () => {},
  };
}

describe('buildAgentEditorProps', () => {
  it('falls back to no-ops for every editor callback when editorCallbacks is undefined (pre-existing, backward-compatible behaviour)', () => {
    const props = buildAgentEditorProps({ ...baseParams(), editorCallbacks: undefined });

    expect(() => props.onShowAgentEditor?.(PARTICIPANT)).not.toThrow();
    expect(() => props.onShowPipelineEditor?.(PARTICIPANT)).not.toThrow();
    expect(() => props.onCloseAgentEditor?.()).not.toThrow();
    expect(() => props.onClosePipelineEditor?.()).not.toThrow();
  });

  it('routes to the real callbacks when editorCallbacks supplies them', () => {
    const onShowAgentEditor = vi.fn();
    const onShowPipelineEditor = vi.fn();
    const onCloseAgentEditor = vi.fn();
    const onClosePipelineEditor = vi.fn();

    const props = buildAgentEditorProps({
      ...baseParams(),
      editorCallbacks: { onShowAgentEditor, onShowPipelineEditor, onCloseAgentEditor, onClosePipelineEditor },
    });

    props.onShowAgentEditor?.(PARTICIPANT);
    props.onShowPipelineEditor?.(PARTICIPANT);
    props.onCloseAgentEditor?.();
    props.onClosePipelineEditor?.();

    expect(onShowAgentEditor).toHaveBeenCalledExactlyOnceWith(PARTICIPANT);
    expect(onShowPipelineEditor).toHaveBeenCalledExactlyOnceWith(PARTICIPANT);
    expect(onCloseAgentEditor).toHaveBeenCalledTimes(1);
    expect(onClosePipelineEditor).toHaveBeenCalledTimes(1);
  });

  it('falls back to a no-op per-field when only some editorCallbacks fields are supplied', () => {
    const onShowAgentEditor = vi.fn();
    const props = buildAgentEditorProps({ ...baseParams(), editorCallbacks: { onShowAgentEditor } });

    props.onShowAgentEditor?.(PARTICIPANT);
    expect(onShowAgentEditor).toHaveBeenCalledExactlyOnceWith(PARTICIPANT);
    expect(() => props.onClosePipelineEditor?.()).not.toThrow();
  });
});
