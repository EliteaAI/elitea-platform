import { useCallback, useState } from 'react';

/**
 * Verbatim port of `apps/elitea-ui/src/hooks/chat/useAttachmentState.js`
 * (unit C1) — basic attachment CRUD state, no network. Generic over `T`
 * (the baseline is untyped JS; this app's real callers hold either raw
 * `File` objects pre-upload, so `T = File` is the expected instantiation,
 * but nothing here depends on that).
 */
export interface UseAttachmentStateResult<T> {
  readonly attachments: readonly T[];
  readonly onAttachFiles: (selectedFiles: readonly T[]) => void;
  readonly onDeleteAttachment: (index: number) => void;
  readonly onClearAttachments: () => void;
  readonly replaceAttachments: (newAttachments: readonly T[]) => void;
}

export function useAttachmentState<T>(initialAttachments: readonly T[] = []): UseAttachmentStateResult<T> {
  const [attachments, setAttachments] = useState<readonly T[]>(initialAttachments);

  const onAttachFiles = useCallback((selectedFiles: readonly T[]) => {
    setAttachments((prev) => [...prev, ...selectedFiles]);
  }, []);

  const onDeleteAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const onClearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const replaceAttachments = useCallback((newAttachments: readonly T[]) => {
    setAttachments(newAttachments);
  }, []);

  return { attachments, onAttachFiles, onDeleteAttachment, onClearAttachments, replaceAttachments };
}
