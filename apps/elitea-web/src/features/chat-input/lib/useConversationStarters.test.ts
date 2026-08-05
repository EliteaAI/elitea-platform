import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { deriveConversationStarters, useConversationStarters, type ConversationStartersParticipantSnapshot } from './useConversationStarters';

describe('deriveConversationStarters (pure core)', () => {
  it('returns [] when neither source has starters', () => {
    expect(deriveConversationStarters(undefined, undefined)).toEqual([]);
  });

  it('prefers activeParticipant.conversationStarters when present', () => {
    const activeParticipant: ConversationStartersParticipantSnapshot = { id: 'a1', conversationStarters: ['Hi'] };
    expect(deriveConversationStarters(activeParticipant, undefined)).toEqual(['Hi']);
  });

  it('does NOT fall back to details when activeParticipant carries an EMPTY (but defined) array', () => {
    const activeParticipant: ConversationStartersParticipantSnapshot = { id: 'a1', conversationStarters: [] };
    const details: ConversationStartersParticipantSnapshot = { id: 'a1', conversationStarters: ['Fallback'] };
    expect(deriveConversationStarters(activeParticipant, details)).toEqual([]);
  });

  it('falls back to activeParticipantDetails when it matches the active participant id', () => {
    const activeParticipant: ConversationStartersParticipantSnapshot = { id: 'a1' };
    const details: ConversationStartersParticipantSnapshot = { id: 'a1', conversationStarters: ['From details'] };
    expect(deriveConversationStarters(activeParticipant, details)).toEqual(['From details']);
  });

  it('ignores activeParticipantDetails when its id does not match the active participant', () => {
    const activeParticipant: ConversationStartersParticipantSnapshot = { id: 'a1' };
    const details: ConversationStartersParticipantSnapshot = { id: 'a2', conversationStarters: ['Wrong entity'] };
    expect(deriveConversationStarters(activeParticipant, details)).toEqual([]);
  });

  it('falls back to details when BOTH ids are undefined — undefined === undefined still counts as a match, matching the baseline exactly', () => {
    const details: ConversationStartersParticipantSnapshot = { conversationStarters: ['x'] };
    expect(deriveConversationStarters(undefined, details)).toEqual(['x']);
  });
});

describe('useConversationStarters (hook wrapper)', () => {
  it('displays the derived (saved) starters when not editing the active participant', () => {
    const { result } = renderHook(() =>
      useConversationStarters({
        activeParticipant: { id: 'a1', conversationStarters: ['Saved starter'] },
        activeParticipantDetails: undefined,
        editingAgentId: undefined,
        editingPipelineId: undefined,
      }),
    );

    expect(result.current.displayedConversationStarters).toEqual(['Saved starter']);
  });

  it('switches to the live editor value once the active participant is being edited', () => {
    const { result, rerender } = renderHook(
      (props: { editingAgentId: string | undefined }) =>
        useConversationStarters({
          activeParticipant: { id: 'a1', conversationStarters: ['Saved starter'] },
          activeParticipantDetails: undefined,
          editingAgentId: props.editingAgentId,
          editingPipelineId: undefined,
        }),
      { initialProps: { editingAgentId: undefined as string | undefined } },
    );

    expect(result.current.displayedConversationStarters).toEqual(['Saved starter']);

    act(() => {
      result.current.handleEditorConversationStartersChange(['Live starter']);
    });
    // Still the saved value: editingAgentId doesn't match the active participant yet.
    expect(result.current.displayedConversationStarters).toEqual(['Saved starter']);

    rerender({ editingAgentId: 'a1' });
    expect(result.current.displayedConversationStarters).toEqual(['Live starter']);
  });

  it('reverts to the saved starters once resetEditorConversationStarters is called', () => {
    const { result, rerender } = renderHook(() =>
      useConversationStarters({
        activeParticipant: { id: 'a1', conversationStarters: ['Saved starter'] },
        activeParticipantDetails: undefined,
        editingAgentId: 'a1',
        editingPipelineId: undefined,
      }),
    );

    act(() => {
      result.current.handleEditorConversationStartersChange(['Live starter']);
    });
    rerender();
    expect(result.current.displayedConversationStarters).toEqual(['Live starter']);

    act(() => {
      result.current.resetEditorConversationStarters();
    });
    rerender();
    expect(result.current.displayedConversationStarters).toEqual(['Saved starter']);
  });

  it('matches on editingPipelineId too', () => {
    const { result, rerender } = renderHook(() =>
      useConversationStarters({
        activeParticipant: { id: 'p1', conversationStarters: [] },
        activeParticipantDetails: undefined,
        editingAgentId: undefined,
        editingPipelineId: 'p1',
      }),
    );

    act(() => {
      result.current.handleEditorConversationStartersChange(['Live pipeline starter']);
    });
    rerender();
    expect(result.current.displayedConversationStarters).toEqual(['Live pipeline starter']);
  });
});
