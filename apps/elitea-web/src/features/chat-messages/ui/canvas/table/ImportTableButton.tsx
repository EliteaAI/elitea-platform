/**
 * ui/canvas/table/ImportTableButton.tsx — the canvas table header's "import"
 * control, ported from `apps/elitea-ui/src/components/ImportTableButton.jsx`.
 * Replaces the `CanvasEditHeader.tsx:368` TODO (a no-op onClick) and the
 * literal `📥` emoji that stood in for its icon.
 *
 * **DEVIATIONS (disclosed):**
 *  1. The baseline built a detached `document.createElement('input')` and
 *     `.click()`ed it. This renders a real, visually-hidden `<input
 *     type="file">` behind the button instead — same UX, but the control is
 *     reachable from a test (`userEvent.upload`) and from assistive tech,
 *     which a detached element is not.
 *  2. Parsing is `../../../lib/markdownTable.ts`'s `parseDelimitedText`, not
 *     `papaparse` (not a dependency here). TSV is accepted alongside CSV.
 *  3. The baseline toasted a parse error through `useToast`. This app has no
 *     toast hook yet (see `processes/chat/model/useChatCopyToClipboard.ts`'s
 *     own note), so a failed read is surfaced through the optional `onError`
 *     callback for the caller to present.
 */
import { useCallback, useId, useRef } from 'react';

import { IconButton, Tooltip } from '@mui/material';

import { ImportIcon } from '@/shared/ui/icons/import-icon';
import { t } from '@/shared/i18n';

import type { MarkdownTableData } from '../../../lib/markdownTable';
import { parseDelimitedText } from '../../../lib/markdownTable';

export interface ImportTableButtonProps {
  /** Receives the parsed table; the canvas editor forwards it to the grid's `resetTable`. */
  readonly onImported: (data: MarkdownTableData) => void;
  readonly disabled?: boolean | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
}

const ACCEPT = '.csv,.tsv,.txt,text/csv,text/tab-separated-values';

/** Opens a file picker and hands the parsed CSV/TSV back as table data. */
export function ImportTableButton({ onImported, disabled, onError }: ImportTableButtonProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Clear immediately: picking the SAME file twice must fire `change` again.
      event.target.value = '';
      if (!file) return;

      file
        .text()
        .then((text) => {
          onImported(parseDelimitedText(text));
        })
        .catch((error: unknown) => {
          onError?.(error);
        });
    },
    [onError, onImported],
  );

  const label = t('features.chatMessages.canvas.table.import', 'Import table (CSV or TSV)');

  return (
    <>
      <Tooltip
        title={disabled === true ? '' : label}
        placement="top"
      >
        <span>
          <IconButton
            size="small"
            disabled={disabled === true}
            aria-label={label}
            onClick={() => inputRef.current?.click()}
          >
            <ImportIcon style={{ width: '16px', height: '16px' }} />
          </IconButton>
        </span>
      </Tooltip>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onChange}
        data-testid="canvas-table-import-input"
        aria-label={label}
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      />
    </>
  );
}
