import { useCallback, useEffect, useMemo, useState } from 'react';

import { isAttachmentsEnabled } from '@/entities/application-form';

/**
 * Ported from `apps/elitea-ui/src/hooks/application/useAgentAttachments.js`
 * (Wave-2 unit A1e). Hook for managing attachments in agent/application
 * context — attachments are handled via internal-tools auto-injection and
 * always use the default attachment bucket.
 *
 * The `disableAttachments` computation itself (`'attachments' in
 * meta.internal_tools`) was already promoted verbatim to
 * `entities/application-form`'s `isAttachmentsEnabled` (Wave-2 promotion
 * pass, Part 3 — see that file's own doc comment) and is reused here rather
 * than re-implemented.
 *
 * **DEVIATIONS FROM BASELINE (both disclosed):**
 *  1. `agentVersionDetails`/`formik.values.version_details.id` (read via
 *     `useFormikContext()`) become explicit `internalTools`/`versionId`
 *     parameters — this app uses react-hook-form, not Formik (§2.3), and
 *     `features/` code should not assume a specific form library is mounted
 *     above it, matching this codebase's established convention (see
 *     `features/mcps/ui/McpAuthStatusBadge.tsx`'s own "DEVIATION FROM
 *     BASELINE" doc comment for the same substitution).
 *  2. `useAttachmentState` (`hooks/chat/useAttachmentState.js`) is chat-
 *     domain machinery, out of this unit's ownership fence (agents/
 *     pipelines/toolkits) and not part of either promoted `entities/`
 *     surface — there is no chat feature slice in this app yet for it to
 *     live in. Read in full: it turned out to have ZERO chat-specific
 *     content (a plain `useState<File[]>` CRUD hook — add/delete-by-index/
 *     clear), so it is inlined here directly rather than invented or
 *     reached for across a slice boundary. A future `features/chat` unit
 *     that needs the exact same shape can promote it to `entities/` or
 *     duplicate it the same way; this file does not claim to be that
 *     hook's canonical home.
 */
export interface UseAgentAttachmentsParams {
  /** `version_details.meta.internal_tools` — drives `disableAttachments`. */
  readonly internalTools: readonly string[] | undefined;
  /** `version_details.id` — attachments are cleared whenever the caller switches to a different version. */
  readonly versionId: string | number | undefined;
}

export interface UseAgentAttachmentsResult {
  readonly attachments: readonly File[];
  readonly onAttachFiles: (files: readonly File[]) => void;
  readonly onDeleteAttachment: (index: number) => void;
  readonly disableAttachments: boolean;
  readonly onClearAttachments: () => void;
}

export function useAgentAttachments({ internalTools, versionId }: UseAgentAttachmentsParams): UseAgentAttachmentsResult {
  // Inlined `useAttachmentState` (see module doc comment, deviation 2).
  const [attachments, setAttachments] = useState<readonly File[]>([]);
  const onAttachFiles = useCallback((files: readonly File[]) => {
    setAttachments((prev) => [...prev, ...files]);
  }, []);
  const onDeleteAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);
  const onClearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const disableAttachments = useMemo(() => !isAttachmentsEnabled(internalTools), [internalTools]);

  // Clear attachments when they become disabled.
  useEffect(() => {
    if (disableAttachments) {
      onClearAttachments();
    }
    return () => {
      onClearAttachments();
    };
  }, [disableAttachments, onClearAttachments]);

  // Clear attachments when the version changes. `onClearAttachments` is
  // stable (useCallback, empty deps) so including it alongside `versionId`
  // is harmless and matches the baseline's own
  // `[formik?.values?.version_details?.id, onClearAttachments]` dep list.
  useEffect(() => {
    onClearAttachments();
  }, [versionId, onClearAttachments]);

  return {
    attachments,
    onAttachFiles,
    onDeleteAttachment,
    disableAttachments,
    onClearAttachments,
  };
}
