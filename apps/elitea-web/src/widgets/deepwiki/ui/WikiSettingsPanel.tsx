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
import { useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { json } from '@codemirror/lang-json';

import type { ToolkitSettings } from '@/entities/wiki';
import { canSaveSettings, parseSettingsDraft, useSaveWikiSettings } from '@/features/wiki-settings';
import { t } from '@/shared/i18n';
import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';

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
  const extensions = useMemo(() => [json()], []);

  return (
    <Stack sx={{ gap: 1 }} data-testid="wiki-settings-panel">
      <Typography variant="bodyMedium" sx={{ fontWeight: 600 }}>{t('deepwiki.settings.title', 'Toolkit settings')}</Typography>
      <CodeMirrorEditor value={draft} onChange={(next) => { setDraft(next); setSaved(false); }} extensions={extensions} minHeight="200px" />

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
        <Button
          variant="contained"
          disabled={!canSaveSettings(parsed) || save.isPending}
          data-testid="wiki-settings-save"
          onClick={() => {
            if (parsed.settings === null) return;
            save.mutate(
              { projectId, toolkitId, toolkit, settings: parsed.settings },
              { onSuccess: () => { setSaved(true); } },
            );
          }}
        >
          {save.isPending ? t('deepwiki.settings.saving', 'Saving…') : t('deepwiki.settings.save', 'Save settings')}
        </Button>
      </Stack>
    </Stack>
  );
}
