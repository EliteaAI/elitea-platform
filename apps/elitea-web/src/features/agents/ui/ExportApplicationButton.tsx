import { type ReactNode, useCallback, useState } from 'react';

import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

import { getConfig } from '@/shared/config';
import { t } from '@/shared/i18n';
import { exportMarkdown } from '@/shared/lib/download';

import { useSelectedProjectId } from '../api/useSelectedProjectId';

/** @public */
export interface ExportApplicationButtonProps {
  applicationId: string | undefined;
  name: string | undefined;
  /** Currently-open version id — old app: `version_id ?? version_details?.id` (`ExportApplicationButton.jsx:27`). */
  currentVersionId?: string | undefined;
  onError?: (error: unknown) => void;
}

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/Components/
 * Applications/ExportApplicationButton.jsx`.
 *
 * DISCLOSED DEVIATIONS:
 *  - No ambient form context — `applicationId`/`name`/`currentVersionId` are
 *    explicit props instead of `useFormikContext()` reads, same convention
 *    as every sibling `features/agents/ui/*` component (`../model/
 *    types.ts`'s module doc comment).
 *  - Calls `shared/lib/download.ts`'s `exportMarkdown` (unit S6) directly
 *    instead of re-deriving `useExport.js`'s applications/pipelines branch
 *    — that function IS the already-ported, already-tested copy of exactly
 *    that branch (`useExport.js:78-101`, cited in `download.ts`'s own doc
 *    comment), so re-deriving it here would duplicate rather than reuse.
 *  - **Real, pre-existing backend/porting inconsistency, surfaced not
 *    invented:** the endpoint both `exportMarkdown` and the OLD app's own
 *    `useExport.js` target
 *    (`/elitea_core/export_import/prompt_lib/{projectId}/{applicationId}`)
 *    is documented on the generated client's `exportApplication` as
 *    `NOTE(W2): internal/api/v2/eliteacore/handler.go:2480-2727 ... format
 *    and follow_version_ids are accepted for old-SPA parity but not read —
 *    markdown export is NOT implemented on the Go router` (`@summary Export
 *    an application (with toolkits) as JSON`). `exportMarkdown` (unit S6)
 *    was built assuming MD export still works; W2's later handler
 *    enrichment found it doesn't. This component still calls the
 *    already-designated shared primitive for this old-app source line
 *    rather than picking a side of that inconsistency itself — if the Go
 *    handler really ignores `format=md`, the browser will download whatever
 *    bytes the handler actually returns (most likely a JSON export) under a
 *    `.md`-suffixed filename, a known gap that belongs to S6/W2's
 *    reconciliation, not a new one introduced here.
 *  - `useIsFromPipelineDetail()` dropped — agents-only scope, same as
 *    `DeleteApplicationButton`'s doc comment.
 *  - `useToast()` replaced with `onError` — same as `DeleteApplicationButton`.
 *  - No toolkit/datasource JSON-export branch — out of this sub-unit's
 *    scope (agents only export as Markdown/JSON via the applications
 *    branch; toolkit export is A4's own component).
 *  - `isPublicApplication`'s published-versions-only filtering (baseline:
 *    `useExport.js:66-76`) is dropped: it only matters for the PUBLIC
 *    project's Agent Studio catalogue and needs a second `getApplication`
 *    fetch to resolve `versions` when the draft doesn't carry them. This
 *    port always sends the single currently-open version id — correct for
 *    the overwhelmingly common (non-public-catalogue) case, and a
 *    conservative default (fewer versions, not more) for the public case
 *    rather than silently guessing which versions count as "published."
 */
export function ExportApplicationButton({ applicationId, name, currentVersionId, onError }: ExportApplicationButtonProps): ReactNode {
  const projectId = useSelectedProjectId();
  const [isExporting, setIsExporting] = useState(false);

  const onExport = useCallback(async () => {
    const config = getConfig();
    if (config.status !== 'ok' || projectId === undefined || applicationId === undefined) return;

    setIsExporting(true);
    try {
      const result = await exportMarkdown(
        {
          baseUrl: config.config.vite_server_url,
          projectId,
          applicationId,
          ...(currentVersionId !== undefined ? { followVersionIds: [currentVersionId] } : {}),
        },
        name ?? applicationId,
      );
      if (!result.ok) onError?.(result.error);
    } finally {
      setIsExporting(false);
    }
  }, [projectId, applicationId, currentVersionId, name, onError]);

  return (
    <Tooltip title={t('agents.exportApplicationButton.title', 'Export agent')}>
      <span>
        <IconButton
          aria-label={t('agents.exportApplicationButton.ariaLabel', 'export agent')}
          color="secondary"
          onClick={() => {
            void onExport();
          }}
          disabled={isExporting}
        >
          {isExporting ? <CircularProgress size={16} /> : <FileDownloadOutlinedIcon fontSize="small" />}
        </IconButton>
      </span>
    </Tooltip>
  );
}
