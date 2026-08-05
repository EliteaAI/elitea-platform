import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/setup';
import { smallFileOk } from '@/test/msw/handlers/upload';

import type { ChatAttachmentsParticipantDetailsGate, ChatAttachmentsParticipantGate } from './chatAttachments.types';
import { useChatAttachments, type UseChatAttachmentsParams } from './useChatAttachments';

const LLM_PARTICIPANT: ChatAttachmentsParticipantGate = { entity_name: 'llm' };
const APP_PARTICIPANT: ChatAttachmentsParticipantGate = { entity_name: 'application' };
const NO_INTERNAL_TOOLS: ChatAttachmentsParticipantDetailsGate = { version_details: { meta: { internal_tools: [] } } };
const WITH_ATTACHMENTS: ChatAttachmentsParticipantDetailsGate = {
  version_details: { meta: { internal_tools: ['attachments'] } },
};

function baseParams(overrides: Partial<UseChatAttachmentsParams> = {}): UseChatAttachmentsParams {
  return {
    activeConversationId: 'conv-1',
    activeParticipant: LLM_PARTICIPANT,
    activeParticipantDetails: undefined,
    ...overrides,
  };
}

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'text/plain' });
}

describe('useChatAttachments', () => {
  it('enables attachments for a plain LLM participant', () => {
    const { result } = renderHook(() => useChatAttachments(baseParams()));
    expect(result.current.disableAttachments).toBe(false);
  });

  it('disables attachments for an application participant missing the attachments internal tool', () => {
    const { result } = renderHook(() =>
      useChatAttachments(baseParams({ activeParticipant: APP_PARTICIPANT, activeParticipantDetails: NO_INTERNAL_TOOLS })),
    );
    expect(result.current.disableAttachments).toBe(true);
  });

  it('enables attachments for an application participant that has the attachments internal tool', () => {
    const { result } = renderHook(() =>
      useChatAttachments(baseParams({ activeParticipant: APP_PARTICIPANT, activeParticipantDetails: WITH_ATTACHMENTS })),
    );
    expect(result.current.disableAttachments).toBe(false);
  });

  it('supports attach/delete/clear CRUD via the composed useAttachmentState', () => {
    const { result } = renderHook(() => useChatAttachments(baseParams()));
    const file = makeFile('a.png');

    act(() => result.current.onAttachFiles([file]));
    expect(result.current.attachments).toEqual([file]);

    act(() => result.current.onDeleteAttachment(0));
    expect(result.current.attachments).toEqual([]);

    act(() => result.current.onAttachFiles([file, makeFile('b.png')]));
    act(() => result.current.onClearAttachments());
    expect(result.current.attachments).toEqual([]);
  });

  it('clears attachments when the active conversation id changes', () => {
    const { result, rerender } = renderHook((params: UseChatAttachmentsParams) => useChatAttachments(params), {
      initialProps: baseParams(),
    });

    act(() => result.current.onAttachFiles([makeFile('a.png')]));
    expect(result.current.attachments).toHaveLength(1);

    rerender(baseParams({ activeConversationId: 'conv-2' }));
    expect(result.current.attachments).toEqual([]);
  });

  it('clears attachments when attaching becomes disabled', () => {
    const { result, rerender } = renderHook((params: UseChatAttachmentsParams) => useChatAttachments(params), {
      initialProps: baseParams({ activeParticipant: APP_PARTICIPANT, activeParticipantDetails: WITH_ATTACHMENTS }),
    });

    act(() => result.current.onAttachFiles([makeFile('a.png')]));
    expect(result.current.attachments).toHaveLength(1);

    rerender(baseParams({ activeParticipant: APP_PARTICIPANT, activeParticipantDetails: NO_INTERNAL_TOOLS }));
    expect(result.current.disableAttachments).toBe(true);
    expect(result.current.attachments).toEqual([]);
  });

  it('exposes the composed useUploadAttachments surface (network upload)', async () => {
    server.use(smallFileOk());
    const { result } = renderHook(() => useChatAttachments(baseParams()));
    const file = makeFile('doc.txt');

    let outcome: Awaited<ReturnType<typeof result.current.uploadAttachments>> | undefined;
    await act(async () => {
      outcome = await result.current.uploadAttachments({
        baseUrl: window.location.origin,
        projectId: 'p1',
        conversationId: 'conv-1',
        attachments: [file],
      });
    });

    expect(outcome?.success).toBe(true);
    await waitFor(() => expect(result.current.isUploading).toBe(false));
  });
});
