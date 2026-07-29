/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useCloseEditorAlert.js` —
 * guards participant/conversation-switch actions behind a confirm dialog
 * when an editor is open (dirty-editor guard) or a stream is in flight
 * (stop-streaming guard). Fully generic/pure (no store reads) in the
 * baseline; ported as-is, just typed. Lives alongside `useEditorMutex`
 * (same cluster) since both are chat-page-level orchestration around the
 * same "an editor/stream is active" concern, but intentionally NOT merged
 * into it — the baseline keeps them as two separate hooks with two separate
 * concerns (editor mutex vs. participant/conversation-switch guard), and a
 * caller may need one without the other (e.g. a read-only conversation view
 * has no editor mutex to enforce but still wants the streaming guard).
 */
import { useCallback, useState } from 'react';

export type CloseEditorType = 'editor' | 'canvas' | 'agent' | 'toolkit' | 'mcp' | 'artifact';

function getEditorWarning(editorType: CloseEditorType): string {
  switch (editorType) {
    case 'canvas':
      return 'You are editing canvas now. Do you want to close it and continue?';
    case 'agent':
      return 'You are editing agent now. Do you want to discard current changes and continue?';
    case 'toolkit':
      return 'You are editing toolkit now. Do you want to discard current changes and continue?';
    case 'mcp':
      return 'You are editing MCP now. Do you want to discard current changes and continue?';
    case 'artifact':
      return 'You are editing artifact now. Do you want to discard current changes and continue?';
    case 'editor':
    default:
      return 'You are editing now. Do you want to discard current changes and continue?';
  }
}

const STREAMING_WARNING = 'Output is still generating.\nSwitching now will stop it and you may lose progress.\nSwitch anyway?';

export interface UseCloseEditorAlertParams<TParticipant, TConversation> {
  readonly editorType?: CloseEditorType;
  readonly isEditorOpen: boolean;
  readonly onCloseEditor?: () => void;
  readonly onSelectParticipant: (participant: TParticipant, shouldMentionUser?: boolean) => void;
  readonly onSelectConversation: (conversation: TConversation) => void;
  readonly onSelectThisParticipant: (participant: TParticipant) => void;
  readonly isStreaming: boolean;
  readonly setIsStreaming: (streaming: boolean) => void;
  /** `boxRef.current?.stopAll()` — the chat box's own imperative "abort every in-flight stream" handle (baseline: a `ChatBox` ref). */
  readonly boxRef: { readonly current: { readonly stopAll?: () => void } | null };
}

export interface UseCloseEditorAlertResult {
  readonly openAlert: boolean;
  readonly alertContent: string;
  readonly setOpenAlert: (open: boolean) => void;
  readonly onHandleSelectParticipant: (participant: unknown, shouldMentionUser?: boolean) => void;
  readonly onHandleSelectConversation: (conversation: unknown) => void;
  readonly onHandleSelectThisParticipant: (participant: unknown) => void;
  readonly onCancelOperation: () => void;
  readonly onConfirmOperation: () => void;
}

export function useCloseEditorAlert<TParticipant = unknown, TConversation = unknown>(
  params: UseCloseEditorAlertParams<TParticipant, TConversation>,
): UseCloseEditorAlertResult {
  const {
    editorType = 'editor',
    isEditorOpen,
    onCloseEditor,
    onSelectParticipant,
    onSelectConversation,
    onSelectThisParticipant,
    isStreaming,
    setIsStreaming,
    boxRef,
  } = params;

  const [operation, setOperation] = useState<(() => void) | undefined>();
  const [openAlert, setOpenAlert] = useState(false);
  const [alertContent, setAlertContent] = useState(getEditorWarning(editorType));

  const onHandleSelectParticipant = useCallback(
    (participant: unknown, shouldMentionUser = true) => {
      if (isEditorOpen) {
        setOperation(() => () => onSelectParticipant(participant as TParticipant, shouldMentionUser));
        setAlertContent(getEditorWarning(editorType));
        setOpenAlert(true);
      } else {
        onSelectParticipant(participant as TParticipant, shouldMentionUser);
      }
    },
    [isEditorOpen, onSelectParticipant, editorType],
  );

  const onHandleSelectConversation = useCallback(
    (conversation: unknown) => {
      if (isEditorOpen) {
        setOperation(() => () => onSelectConversation(conversation as TConversation));
        setAlertContent(getEditorWarning(editorType));
        setOpenAlert(true);
      } else if (isStreaming) {
        setOperation(() => () => {
          boxRef.current?.stopAll?.();
          setIsStreaming(false);
          onSelectConversation(conversation as TConversation);
        });
        setAlertContent(STREAMING_WARNING);
        setOpenAlert(true);
      } else {
        onSelectConversation(conversation as TConversation);
      }
    },
    [isEditorOpen, isStreaming, onSelectConversation, setIsStreaming, boxRef, editorType],
  );

  const onHandleSelectThisParticipant = useCallback(
    (participant: unknown) => {
      if (isEditorOpen) {
        setOperation(() => () => onSelectThisParticipant(participant as TParticipant));
        setAlertContent(getEditorWarning(editorType));
        setOpenAlert(true);
      } else {
        onSelectThisParticipant(participant as TParticipant);
      }
    },
    [isEditorOpen, onSelectThisParticipant, editorType],
  );

  const onCancelOperation = useCallback(() => {
    setOperation(undefined);
    setOpenAlert(false);
  }, []);

  const onConfirmOperation = useCallback(() => {
    onCloseEditor?.();
    setOpenAlert(false);
    operation?.();
    setOperation(undefined);
  }, [onCloseEditor, operation]);

  return {
    openAlert,
    alertContent,
    setOpenAlert,
    onHandleSelectParticipant,
    onHandleSelectConversation,
    onHandleSelectThisParticipant,
    onCancelOperation,
    onConfirmOperation,
  };
}
