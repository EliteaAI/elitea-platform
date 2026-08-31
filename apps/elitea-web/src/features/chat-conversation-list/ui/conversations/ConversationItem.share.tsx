/**
 * The share-by-link affordance's mount point, split out of `ConversationItem`
 * purely to keep that file under the §3.5 `max-lines` budget (400).
 *
 * It carries one real decision of its own: `projectId` is REQUIRED to address
 * the conversation, so the dialog is simply absent without one. An undefined
 * project id would be interpolated into the request path and resolve to a
 * different tenant's schema on the server, and publishing a transcript is the
 * last place to be permissive about which tenant is meant.
 */
import type { ReactNode } from 'react';

import { ShareLinkDialog } from './ShareLinkDialog';

export interface ConversationShareDialogProps {
  readonly open: boolean;
  readonly projectId: string | undefined;
  readonly conversationId: string | number;
  readonly conversationName: string | undefined;
  readonly onClose: () => void;
}

export function ConversationShareDialog(props: ConversationShareDialogProps): ReactNode {
  const { open, projectId, conversationId, conversationName, onClose } = props;
  if (!open || projectId === undefined) return null;
  return (
    <ShareLinkDialog
      open
      projectId={projectId}
      conversationId={conversationId}
      {...(conversationName !== undefined ? { conversationName } : {})}
      onClose={onClose}
    />
  );
}
