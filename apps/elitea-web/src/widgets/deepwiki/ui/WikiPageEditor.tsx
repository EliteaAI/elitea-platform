/**
 * Edit one wiki page's markdown and save it back (DWIKI-009).
 *
 * A FAILED SAVE KEEPS THE EDITOR OPEN. The acceptance criterion names this
 * because the alternative is the worse failure: an editor that closes on error
 * looks exactly like one that saved, and the user finds out on the next read
 * that their edit is gone. The reason is shown in the editor, the draft stays
 * as typed, and Save can be tried again.
 */
import { useCallback, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import { useQueryClient } from '@tanstack/react-query';

import { putWikiPage } from '@/entities/wiki';
import { t } from '@/shared/i18n';
import { BannerMessage } from '@/shared/ui/BannerMessage';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BaseModal } from '@/shared/ui/BaseModal';
import { CodeMirrorEditor, type CodeMirrorEditorHandle } from '@/shared/ui/CodeMirrorEditor';

/** The editor fills most of the viewport: a page is long, and 60vh is what the app's other in-modal editors take. */
const EDITOR_HEIGHT = '60vh';
const EDITOR_MIN_HEIGHT = '20rem';

interface WikiPageEditorProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projectId: string | number;
  readonly pageKey: string;
  readonly markdown: string;
  /** Called with the saved text, so the reader can show it without a refetch. */
  readonly onSaved?: (markdown: string) => void;
}

export function WikiPageEditor({
  open,
  onClose,
  projectId,
  pageKey,
  markdown,
  onSaved,
}: WikiPageEditorProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(markdown);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Saved from CodeMirror's own document, not the debounced `draft` mirror —
  // a Save inside the 30ms window would otherwise write the previous text.
  const editorRef = useRef<CodeMirrorEditorHandle>(null);
  const save = useCallback(async () => {
    const text = editorRef.current?.getCode() ?? draft;
    setSaving(true);
    setError(null);
    try {
      await putWikiPage(projectId, pageKey, text);
      void queryClient.invalidateQueries({ queryKey: ['deepwiki', 'page'] });
      onSaved?.(text);
      onClose();
    } catch (cause) {
      // The editor stays OPEN with the reason. Closing here would be the
      // failure the acceptance criterion names.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [draft, onClose, onSaved, pageKey, projectId, queryClient]);

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      variant="complex"
      title={t('deepwiki.editor.title', 'Edit page')}
      data-testid="wiki-page-editor"
      content={
        <Stack sx={{ gap: 1 }}>
          {error === null ? null : (
            <Box data-testid="wiki-page-editor-error">
              <BannerMessage
                variant="error"
                message={t('deepwiki.editor.saveFailed', 'The page was not saved: {{reason}}', { reason: error })}
              />
            </Box>
          )}
          <CodeMirrorEditor ref={editorRef} value={draft} onChange={setDraft} minHeight={EDITOR_MIN_HEIGHT} height={EDITOR_HEIGHT} />
        </Stack>
      }
      actions={{
        node: (
          <>
            <BaseBtn variant="secondary" onClick={onClose} disabled={saving}>
              {t('deepwiki.editor.cancel', 'Cancel')}
            </BaseBtn>
            <BaseBtn variant="elitea" onClick={() => void save()} loading={saving} data-testid="wiki-page-editor-save">
              {t('deepwiki.editor.save', 'Save')}
            </BaseBtn>
          </>
        ),
      }}
    />
  );
}
