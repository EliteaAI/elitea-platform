import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  useNewConversationAttachments,
  type NewConversationSelectedParticipant,
  type UseNewConversationAttachmentsParams,
} from './useNewConversationAttachments';

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'text/plain' });
}

describe('useNewConversationAttachments', () => {
  it('enables attachments for a plain LLM selected participant', () => {
    const { result } = renderHook(() =>
      useNewConversationAttachments({ selectedParticipant: { entity_name: 'llm' }, activeParticipantDetails: undefined }),
    );
    expect(result.current.disableAttachments).toBe(false);
  });

  it('falls back to selectedParticipant as the details source when activeParticipantDetails has not resolved yet', () => {
    // selectedParticipant already carries version_details from the initial load (baseline comment) —
    // activeParticipantDetails is still undefined (not yet fetched).
    const selectedParticipant: NewConversationSelectedParticipant = {
      entity_name: 'application',
      version_details: { meta: { internal_tools: ['attachments'] } },
    };
    const { result } = renderHook(() =>
      useNewConversationAttachments({ selectedParticipant, activeParticipantDetails: undefined }),
    );
    expect(result.current.disableAttachments).toBe(false);
  });

  it('prefers activeParticipantDetails once it has resolved, even when it disagrees with selectedParticipant', () => {
    const selectedParticipant: NewConversationSelectedParticipant = {
      entity_name: 'application',
      version_details: { meta: { internal_tools: ['attachments'] } },
    };
    const { result } = renderHook(() =>
      useNewConversationAttachments({
        selectedParticipant,
        activeParticipantDetails: { version_details: { meta: { internal_tools: [] } } },
      }),
    );
    expect(result.current.disableAttachments).toBe(true);
  });

  it('disables attachments for an application participant with no resolvable internal_tools at all', () => {
    const { result } = renderHook(() =>
      useNewConversationAttachments({
        selectedParticipant: { entity_name: 'application' },
        activeParticipantDetails: undefined,
      }),
    );
    expect(result.current.disableAttachments).toBe(true);
  });

  it('supports attach/delete/clear CRUD via the composed useAttachmentState', () => {
    const params: UseNewConversationAttachmentsParams = {
      selectedParticipant: { entity_name: 'llm' },
      activeParticipantDetails: undefined,
    };
    const { result } = renderHook(() => useNewConversationAttachments(params));
    const file = makeFile('a.png');

    act(() => result.current.onAttachFiles([file]));
    expect(result.current.attachments).toEqual([file]);

    act(() => result.current.onDeleteAttachment(0));
    expect(result.current.attachments).toEqual([]);
  });

  it('does NOT clear attachments on its own when disableAttachments flips true (no clearing effect, unlike useChatAttachments)', () => {
    const { result, rerender } = renderHook(
      (params: UseNewConversationAttachmentsParams) => useNewConversationAttachments(params),
      {
        initialProps: {
          selectedParticipant: { entity_name: 'llm' },
          activeParticipantDetails: undefined,
        },
      },
    );

    act(() => result.current.onAttachFiles([makeFile('a.png')]));
    expect(result.current.attachments).toHaveLength(1);

    rerender({ selectedParticipant: { entity_name: 'application' }, activeParticipantDetails: undefined });
    expect(result.current.disableAttachments).toBe(true);
    // Baseline useNewConversationAttachments.js has zero useEffect calls — attachments persist.
    expect(result.current.attachments).toHaveLength(1);
  });
});
