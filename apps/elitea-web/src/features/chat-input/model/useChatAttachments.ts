import { useEffect, useMemo } from 'react';

import { getAttachmentDisabledStatus } from '@/entities/attachment';
import { useAttachmentState, useUploadAttachments } from '@/entities/conversation';

import type { ChatAttachmentsParticipantDetailsGate, ChatAttachmentsParticipantGate } from './chatAttachments.types';

/**
 * Thin composing hook mirroring `apps/elitea-ui/src/hooks/chat/
 * useAttachments.js`'s real, IN-SCOPE surface — confirmed by prior research
 * (this unit's own brief) that the baseline's `onSelectAttachmentManager`/
 * `selectedManager`/`isSettingManager` (attachment-storage-TOOLKIT-selection,
 * RTK mutation + Formik form editing) belongs to a different, not-yet-built
 * unit (the participants-settings surface), never the chat message-input
 * send box this slice owns. Dropped here, not ported.
 *
 * Composes two ALREADY-BUILT `entities/conversation` hooks (unit C1) rather
 * than re-deriving their logic:
 *  - `useAttachmentState<File>()` — local-array CRUD (baseline:
 *    `hooks/chat/useAttachmentState.js`, itself already zero chat-specific
 *    content per that hook's own doc comment).
 *  - `useUploadAttachments()` — network upload-with-progress. NOT called by
 *    the baseline `useAttachments.js` itself (the baseline's OWN
 *    `useUploadAttachments.js` is invoked separately, one layer up, by
 *    `ConfigurationTab.jsx`/`NewChat.jsx`). Folded in here anyway — a
 *    disclosed judgment call, not a literal 1:1 port: this feature slice
 *    owns the send box end-to-end, and per this unit's own task context
 *    ("`useAttachmentState`/`useUploadAttachments` ... call them directly")
 *    a single hook exposing both pending-attachment state AND the means to
 *    upload it on send is the natural shape for that composition root to
 *    consume, rather than requiring it to separately import and wire a
 *    second hook for the identical concern.
 *
 * `activeParticipant`/`activeParticipantDetails` are typed against this
 * slice's own `ChatAttachmentsParticipantGate`/`...DetailsGate` (see
 * `./chatAttachments.types.ts`'s doc comment for why those are structural
 * duplicates, not an import, of entities/attachment's identically-shaped
 * gate types) — a forward-compatible seam: the real caller (chat-messages/
 * chat composition root, built later) supplies whatever raw participant
 * object it holds; this hook does not care which normalised/raw shape that
 * is, only that it structurally matches.
 *
 * `activeConversationId` replaces the baseline's whole `activeConversation`
 * object — only `.id` is ever read (baseline lines ~72-74), so the
 * narrower primitive avoids coupling this hook to any specific Conversation
 * shape.
 */
export interface UseChatAttachmentsParams {
  readonly activeConversationId: string | undefined;
  readonly activeParticipant: ChatAttachmentsParticipantGate | null | undefined;
  readonly activeParticipantDetails: ChatAttachmentsParticipantDetailsGate | null | undefined;
}

export interface UseChatAttachmentsResult {
  readonly attachments: readonly File[];
  readonly disableAttachments: boolean;
  readonly onAttachFiles: (files: readonly File[]) => void;
  readonly onDeleteAttachment: (index: number) => void;
  readonly onClearAttachments: () => void;
  readonly uploadAttachments: ReturnType<typeof useUploadAttachments>['uploadAttachments'];
  readonly uploadingAttachments: readonly File[];
  readonly isUploading: boolean;
  readonly uploadProgress: number;
}

export function useChatAttachments(params: UseChatAttachmentsParams): UseChatAttachmentsResult {
  const { activeConversationId, activeParticipant, activeParticipantDetails } = params;

  const { attachments, onAttachFiles, onDeleteAttachment, onClearAttachments } = useAttachmentState<File>();
  const { uploadAttachments, uploadingAttachments, isUploading, uploadProgress } = useUploadAttachments();

  const disableAttachments = useMemo(
    () => getAttachmentDisabledStatus(activeParticipant, activeParticipantDetails),
    [activeParticipant, activeParticipantDetails],
  );

  // baseline useAttachments.js:70-73 — clear attachments whenever the active conversation changes.
  useEffect(() => {
    onClearAttachments();
  }, [activeConversationId, onClearAttachments]);

  // baseline useAttachments.js:75-80 — clear attachments whenever attaching becomes disabled.
  useEffect(() => {
    if (disableAttachments) onClearAttachments();
  }, [disableAttachments, onClearAttachments]);

  return {
    attachments,
    disableAttachments,
    onAttachFiles,
    onDeleteAttachment,
    onClearAttachments,
    uploadAttachments,
    uploadingAttachments,
    isUploading,
    uploadProgress,
  };
}
