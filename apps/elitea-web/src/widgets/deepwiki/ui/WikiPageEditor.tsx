/**
 * Edit one wiki page's markdown and save it back (DWIKI-009).
 *
 * A FAILED SAVE KEEPS THE EDITOR OPEN. The acceptance criterion names this
 * because the alternative is the worse failure: an editor that closes on error
 * looks exactly like one that saved, and the user finds out on the next read
 * that their edit is gone. The reason is shown in the editor, the draft stays
 * as typed, and Save can be tried again.
 */
import { useCallback, useState } from 'react';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useQueryClient } from '@tanstack/react-query';

import { putWikiPage } from '@/entities/wiki';
import { t } from '@/shared/i18n';
import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';

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

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await putWikiPage(projectId, pageKey, draft);
      void queryClient.invalidateQueries({ queryKey: ['deepwiki', 'page'] });
      onSaved?.(draft);
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
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth data-testid="wiki-page-editor">
      <DialogTitle>{t('deepwiki.editor.title', 'Edit page')}</DialogTitle>
      <DialogContent>
        {error === null ? null : (
          <Alert severity="error" sx={{ mb: 1 }} data-testid="wiki-page-editor-error">
            {t('deepwiki.editor.saveFailed', 'The page was not saved: {{reason}}', { reason: error })}
          </Alert>
        )}
        <CodeMirrorEditor value={draft} onChange={setDraft} minHeight="320px" height="60vh" />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('deepwiki.editor.cancel', 'Cancel')}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving} data-testid="wiki-page-editor-save">
          {saving ? t('deepwiki.editor.saving', 'Saving…') : t('deepwiki.editor.save', 'Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
