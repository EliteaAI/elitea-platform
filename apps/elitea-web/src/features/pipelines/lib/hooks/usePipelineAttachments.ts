/**
 * Local duplicate of `apps/elitea-ui/src/hooks/application/
 * useAgentAttachments.js`, scoped to `features/pipelines` — per this
 * mission's own explicit instruction: "`usePipelineChat.hooks.js` ...
 * originally imported `useAgentAttachments` ... from A1 -- `useAgentAttachments`
 * would need A1e exported (forbidden sideways otherwise; A1e is a
 * `features/agents` slice, so this specific one genuinely cannot be
 * imported directly)". `features/agents/lib/useAgentAttachments.ts` (Wave-2
 * unit A1e) already ported this exact baseline file faithfully; this file
 * reproduces that same port (not a re-derivation from the old baseline) so
 * both domains' attachment behaviour stays identical, adapted only in name
 * (`usePipelineAttachments`, to avoid an "agent" name on a pipelines-owned
 * file) — see that file's own doc comment for the two disclosed deviations
 * this port carries forward unchanged:
 *  1. `internalTools`/`versionId` are explicit parameters, not read via
 *     `useFormikContext()` (this app has no Formik).
 *  2. The baseline's `useAttachmentState` (`hooks/chat/useAttachmentState.js`)
 *     turned out to be a plain `useState<File[]>` CRUD hook with zero
 *     chat-specific content, so it is inlined directly rather than reached
 *     for across a slice boundary that does not exist yet (no `features/
 *     chat` in this app).
 *
 * `isAttachmentsEnabled` is reused from the promoted `entities/
 * application-form` (legal: `entities/` is freely importable from
 * `features/`), not re-implemented, matching A1e's own reuse of it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { isAttachmentsEnabled } from '@/entities/application-form';

export interface UsePipelineAttachmentsParams {
  /** `version_details.meta.internal_tools` — drives `disableAttachments`. */
  readonly internalTools: readonly string[] | undefined;
  /** `version_details.id` — attachments are cleared whenever the caller switches to a different version. */
  readonly versionId: string | number | undefined;
}

export interface UsePipelineAttachmentsResult {
  readonly attachments: readonly File[];
  readonly onAttachFiles: (files: readonly File[]) => void;
  readonly onDeleteAttachment: (index: number) => void;
  readonly disableAttachments: boolean;
  readonly onClearAttachments: () => void;
}

export function usePipelineAttachments({
  internalTools,
  versionId,
}: UsePipelineAttachmentsParams): UsePipelineAttachmentsResult {
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

  useEffect(() => {
    if (disableAttachments) {
      onClearAttachments();
    }
    return () => {
      onClearAttachments();
    };
  }, [disableAttachments, onClearAttachments]);

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
