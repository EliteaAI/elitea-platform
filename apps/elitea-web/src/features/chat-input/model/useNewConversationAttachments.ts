import { useMemo } from 'react';

import { getAttachmentDisabledStatus } from '@/entities/attachment';
import { useAttachmentState, useUploadAttachments } from '@/entities/conversation';

import type { ChatAttachmentsParticipantDetailsGate, ChatAttachmentsParticipantGate } from './chatAttachments.types';

/**
 * Narrower composing hook mirroring `apps/elitea-ui/src/hooks/chat/
 * useNewConversationAttachments.js` — the pre-conversation-exists variant
 * used while composing the very first message of a not-yet-created
 * conversation. Two differences from `useChatAttachments`, both matching
 * the baseline exactly:
 *  - No conversation-id-clearing effect: there is no active conversation
 *    yet in this context, so there is no id to key a clearing effect on
 *    (the baseline has none either).
 *  - No manager-selection surface at all (the baseline's own doc comment:
 *    "attachments are now handled via internal tools auto-injection and
 *    always use the default attachment bucket" — out of scope here for the
 *    same reason it is out of scope for `useChatAttachments`).
 *  - No disableAttachments-clearing effect either (verified against the
 *    baseline: unlike `useAttachments.js`, `useNewConversationAttachments.js`
 *    has ZERO `useEffect` calls at all — `disableAttachments` is exposed as
 *    plain derived state for the caller to act on, not auto-cleared).
 *
 * `selectedParticipant` is typed as the INTERSECTION of both gate shapes
 * (`ChatAttachmentsParticipantGate & ChatAttachmentsParticipantDetailsGate`)
 * because the baseline's own fallback logic reads it as BOTH a participant
 * (`entity_name`) AND, when `activeParticipantDetails` has not resolved yet,
 * as a stand-in "details" argument (`version_details`) — baseline comment,
 * preserved: "Fall back to selectedParticipant (which already carries
 * version_details from the initial load) until activeParticipantDetails is
 * populated by the API call."
 */
export type NewConversationSelectedParticipant = ChatAttachmentsParticipantGate & ChatAttachmentsParticipantDetailsGate;

export interface UseNewConversationAttachmentsParams {
  readonly selectedParticipant: NewConversationSelectedParticipant | null | undefined;
  readonly activeParticipantDetails: ChatAttachmentsParticipantDetailsGate | null | undefined;
}

export interface UseNewConversationAttachmentsResult {
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

export function useNewConversationAttachments(
  params: UseNewConversationAttachmentsParams,
): UseNewConversationAttachmentsResult {
  const { selectedParticipant, activeParticipantDetails } = params;

  const { attachments, onAttachFiles, onDeleteAttachment, onClearAttachments } = useAttachmentState<File>();
  const { uploadAttachments, uploadingAttachments, isUploading, uploadProgress } = useUploadAttachments();

  const disableAttachments = useMemo(() => {
    const detailsForCheck = activeParticipantDetails?.version_details ? activeParticipantDetails : selectedParticipant;
    return getAttachmentDisabledStatus(selectedParticipant, detailsForCheck);
  }, [selectedParticipant, activeParticipantDetails]);

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
