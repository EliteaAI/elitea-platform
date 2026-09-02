/**
 * Edit the toolkit's settings as JSON and save them (DWIKI-010).
 *
 * VALIDATION IS `parseSettingsDraft`, not this component. It returns every
 * problem with the field it belongs to, and the one check the legacy screen
 * never made — that a repository is configured at all — is what stops a
 * generation from running and finding nothing.
 *
 * THE WHOLE TOOLKIT IS SENT. The route is a PUT and replaces the resource;
 * `useSaveWikiSettings` spreads the toolkit as last read and overwrites only
 * `settings`, which is why this panel needs the raw row and not just the
 * settings.
 */
import { useMemo, useRef, useState } from 'react';

import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { json } from '@codemirror/lang-json';

import type { ToolkitSettings } from '@/entities/wiki';
import { canSaveSettings, parseSettingsDraft, useSaveWikiSettings } from '@/features/wiki-settings';
import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { CodeMirrorEditor, type CodeMirrorEditorHandle } from '@/shared/ui/CodeMirrorEditor';

/** Room for a typical toolkit document without scrolling; the editor grows with the draft. */
const SETTINGS_EDITOR_MIN_HEIGHT = '12.5rem';

interface WikiSettingsPanelProps {
  readonly projectId: string | number;
  readonly toolkitId: string | number;
  /** The toolkit row as last read. */
  readonly toolkit: Record<string, unknown>;
  readonly settings: ToolkitSettings;
}

export function WikiSettingsPanel({ projectId, toolkitId, toolkit, settings }: WikiSettingsPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => JSON.stringify(settings, null, 2));
  const [saved, setSaved] = useState(false);
  const save = useSaveWikiSettings();
  const parsed = useMemo(() => parseSettingsDraft(draft), [draft]);
  // Read at Save time straight from CodeMirror: `draft` is the editor's
  // DEBOUNCED mirror (30ms), and a Save pressed inside that window saved the
  // previous document — the journey caught a good save where a refusal was
  // due, because the refused text had not reached `draft` yet.
  const editorRef = useRef<CodeMirrorEditorHandle>(null);
  const extensions = useMemo(() => [json()], []);

  return (
    <Stack sx={{ gap: 1 }} data-testid="wiki-settings-panel">
      <Typography variant="headingSmall">{t('deepwiki.settings.title', 'Toolkit settings')}</Typography>
      <CodeMirrorEditor ref={editorRef} value={draft} onChange={(next) => { setDraft(next); setSaved(false); }} extensions={extensions} minHeight={SETTINGS_EDITOR_MIN_HEIGHT} />

      {parsed.problems.map((problem) => (
        <Alert key={`${problem.field ?? 'document'}:${problem.message}`} severity="warning" data-testid="wiki-settings-problem" data-field={problem.field ?? ''}>
          {problem.field === null ? problem.message : `${problem.field}: ${problem.message}`}
        </Alert>
      ))}

      {save.isError ? (
        <Alert severity="error" data-testid="wiki-settings-error">
          {t('deepwiki.settings.saveFailed', 'The settings were not saved: {{reason}}', { reason: save.error.message })}
        </Alert>
      ) : null}
      {saved && save.isSuccess ? (
        <Alert severity="success" data-testid="wiki-settings-saved">
          {t('deepwiki.settings.saved', 'Settings saved. The next generation will use them.')}
        </Alert>
      ) : null}

      <Stack sx={{ flexDirection: 'row', gap: 1 }}>
        <BaseBtn
          variant="elitea"
          disabled={!canSaveSettings(parsed)}
          loading={save.isPending}
          data-testid="wiki-settings-save"
          onClick={() => {
            const current = editorRef.current?.getCode() ?? draft;
            const now = current === draft ? parsed : parseSettingsDraft(current);
            if (current !== draft) {
              setDraft(current);
              setSaved(false);
            }
            if (!canSaveSettings(now) || now.settings === null) return;
            save.mutate(
              { projectId, toolkitId, toolkit, settings: now.settings },
              { onSuccess: () => { setSaved(true); } },
            );
          }}
        >
          {t('deepwiki.settings.save', 'Save settings')}
        </BaseBtn>
      </Stack>
    </Stack>
  );
}
