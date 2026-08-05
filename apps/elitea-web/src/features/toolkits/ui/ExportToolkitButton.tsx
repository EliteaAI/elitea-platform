import { type ReactNode, useCallback, useState } from 'react';

import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { eliteaFetch } from '@/shared/api/generated/mutator';
import { triggerBlobDownload } from '@/shared/lib/download';

import { useSelectedProjectId } from '../lib/hooks/useSelectedProjectId';

/** @public */
export interface ExportToolkitButtonProps {
  readonly toolkitId: string | undefined;
  readonly name: string | undefined;
  readonly disabled?: boolean;
  readonly onError?: (error: unknown) => void;
}

interface ExportToolkitResponse {
  readonly data: unknown;
}

/**
 * `GET /elitea_core/export_toolkit/prompt_lib/{projectId}/{id}` — no
 * generated endpoint exists for this route (see `../api/toolkits.ts`'s
 * module doc comment for the full inventory), so this calls the SAME
 * `eliteaFetch` primitive every generated endpoint wrapper calls
 * internally, with a hand-built relative URL (matching the exact shape
 * `getDeleteApplicationToolUrl` and every other generated `getXUrl` helper
 * produce — bare path, no `baseUrl` prefix, the configured HTTP client
 * resolves that). This keeps the SAME auth/credentials/error-unwrap
 * handling every other endpoint in this app gets, unlike `shared/lib/
 * download.ts`'s `exportMarkdown` (which hand-rolls a raw `fetch()` — a
 * deliberate, `R-A1`-sanctioned exception ONLY because that endpoint's
 * response is a markdown blob `HttpResult<T>`/`eliteaFetch` cannot
 * represent). This endpoint's response is plain JSON, so `eliteaFetch` is
 * the correct, minimal-invention primitive to reach for instead of
 * reproducing that raw-fetch exception a second time for a response shape
 * it was never needed for.
 */
async function fetchToolkitExport(projectId: string, id: string): Promise<unknown> {
  const result = await eliteaFetch<ExportToolkitResponse>(`/elitea_core/export_toolkit/prompt_lib/${projectId}/${id}`, { method: 'GET' });
  return result.data;
}

/**
 * Ported from `apps/elitea-ui/src/pages/Toolkits/ExportToolkitButton.jsx`
 * (86 lines) + the toolkit branch of `pages/Common/Components/useExport.js`
 * (`entity_name === 'toolkits'`, lines 115-127) — that hook's own doc
 * comment on `features/agents/ui/ExportApplicationButton.tsx` explicitly
 * scopes the toolkit JSON-export branch to "A4's own component", i.e. this
 * file.
 *
 * DISCLOSED DEVIATIONS (same shape `ExportApplicationButton.tsx`/
 * `DeleteToolkitButton.tsx` already establish for this unit):
 *  - No ambient Formik context — `toolkitId`/`name` are explicit props
 *    instead of `useFormikContext().values.{id,name,owner_id}` reads.
 *  - `owner_id`-vs-`selectedProjectId` project resolution (baseline
 *    `useExport.js:35-38`, only relevant for exporting a PUBLIC-project
 *    toolkit you don't own) is dropped — this always exports from the
 *    caller's currently selected project, the overwhelmingly common case;
 *    a public-toolkit variant would need an explicit `ownerProjectId` prop,
 *    which no call site in this unit's owned files supplies.
 *  - `useToast()` replaced with `onError` — same as `DeleteToolkitButton`.
 *  - GA event tracking (`ENTITY_EXPORTED`) dropped — no analytics-event SDK
 *    exists anywhere in this app (same documented gap `AgentEditor.tsx`'s
 *    doc comment gives).
 */
export function ExportToolkitButton({ toolkitId, name, disabled = false, onError }: ExportToolkitButtonProps): ReactNode {
  const projectId = useSelectedProjectId();
  const [isExporting, setIsExporting] = useState(false);

  const onExport = useCallback(async () => {
    if (projectId === undefined || toolkitId === undefined) return;
    setIsExporting(true);
    try {
      const data = await fetchToolkitExport(projectId, toolkitId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      triggerBlobDownload(blob, `${name ?? toolkitId}.json`);
    } catch (error) {
      onError?.(error);
    } finally {
      setIsExporting(false);
    }
  }, [projectId, toolkitId, name, onError]);

  return (
    <Tooltip title={t('toolkits.exportToolkitButton.title', 'Export toolkit')}>
      <span>
        <IconButton
          aria-label={t('toolkits.exportToolkitButton.ariaLabel', 'export toolkit')}
          color="secondary"
          onClick={() => {
            void onExport();
          }}
          disabled={isExporting || disabled}
        >
          {isExporting ? <CircularProgress size={16} /> : <FileDownloadOutlinedIcon fontSize="small" />}
        </IconButton>
      </span>
    </Tooltip>
  );
}
