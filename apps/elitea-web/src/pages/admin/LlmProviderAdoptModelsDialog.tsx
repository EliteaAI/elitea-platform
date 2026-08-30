/**
 * Adopt models from a platform provider — the successor to legacy's
 * `import_llm_models` admin task, as a deliberate act rather than a cron job.
 *
 * ## What changed, and why this is a dialog
 *
 * Legacy read LiteLLM's own model table on a schedule and created a shared
 * model row for every unmanaged entry it found. Bifrost keeps no such table,
 * so the provider itself is the inventory — the server asks it, through the
 * gateway, with the stored credential.
 *
 * The scheduled import is NOT reproduced, and that is the substantive change.
 * Publishing a model makes it available to every project on the deployment, so
 * "everything the provider happens to offer today" is not a defensible default:
 * a provider that adds thirty preview models adds thirty entries to every
 * project's model picker, with nobody having decided so. The operator picks.
 *
 * ## Ids already in the catalogue are shown checked and disabled
 *
 * Not hidden. An operator looking for a model needs to see that it is already
 * published — a missing row reads as "this provider does not offer it", which
 * is the reading that sends them to look somewhere else. `elitea_title` is
 * UNIQUE per project, so a second row of the same name cannot exist anyway:
 * the disabled box is that rule made visible, not a courtesy.
 *
 * ## The kind is asked for, never guessed
 *
 * A provider listing gives NAMES ONLY. Nothing in "text-embedding-3-large"
 * tells this screen that it is an embedding model except a substring, and a
 * model filed under the wrong (section, type) pair is invisible to every
 * dispatch path while looking complete in the table. So the kind is a field,
 * applied to the batch, and models of another kind are adopted in their own
 * pass.
 *
 * The dialog's own STATE — the two queries, the selection, the adoption loop —
 * lives in `./useAdoptProviderModels`. This file is what it looks like.
 */
import type { ReactNode } from 'react';

import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import {
  AdoptDialogActions,
  AdoptKindField,
  AdoptModelAlerts,
  AdoptModelList,
  AdoptProgress,
  AdoptSelectionBar,
} from './LlmProviderAdoptModelsParts';
import type { LlmProvider } from './api/adminLlmProvidersApi';
import { useAdoptProviderModels } from './useAdoptProviderModels';

export interface LlmProviderAdoptModelsDialogProps {
  /** The provider being adopted from, or `undefined` when the dialog is closed. */
  readonly provider: LlmProvider | undefined;
  readonly onClose: () => void;
}

export function LlmProviderAdoptModelsDialog({
  provider,
  onClose,
}: LlmProviderAdoptModelsDialogProps): ReactNode {
  const state = useAdoptProviderModels(provider, onClose);

  return (
    <Dialog open={provider !== undefined} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {t('pages.admin.adoptModels.title', 'Adopt models from {{name}}', {
          name: provider?.elitea_title ?? '',
        })}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingTop: '0.5rem' }}
      >
        <Typography variant="bodySmall" color="text.secondary">
          {t(
            'pages.admin.adoptModels.intro',
            'These are the models this credential can see at its provider. Each one you adopt becomes a platform model, offered to every project on this deployment.',
          )}
        </Typography>

        <AdoptModelAlerts
          loadError={state.loadError}
          truncated={state.truncated}
          failures={state.failures}
        />

        <AdoptKindField
          value={state.kind}
          modelTypes={state.modelTypes}
          disabled={state.adopting}
          onChange={state.setKind}
        />

        <AdoptProgress isPending={state.isPending} />

        <AdoptSelectionBar
          selectable={state.selectable}
          selected={state.selected}
          disabled={state.adopting}
          onSelectAll={(all) => state.setSelected(all ? state.selectable : [])}
        />

        <AdoptModelList
          models={state.models}
          adopted={state.adopted}
          selected={state.selected}
          disabled={state.adopting}
          onToggle={state.toggle}
          isPending={state.isPending}
          failed={state.loadError !== undefined}
        />
      </DialogContent>
      <AdoptDialogActions
        adopting={state.adopting}
        canAdopt={state.selected.length > 0}
        onCancel={onClose}
        onAdopt={state.adopt}
      />
    </Dialog>
  );
}
