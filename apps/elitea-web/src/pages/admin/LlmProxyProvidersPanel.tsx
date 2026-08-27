/**
 * Admin › Configuration › LLM Proxy — **Providers**.
 *
 * ## What this screen makes possible
 *
 * Publishing an LLM provider credential once, for the whole platform, instead of
 * once per project. That was always what the gateway resolved — the caller's
 * project plus the public project's `shared = true` rows (issue #316) — but the
 * only way to author one was to open the public project's ordinary settings
 * screen, know that it was the global scope, and be a member of it.
 *
 * ## `status_ok` is the column that decides whether anything happens
 *
 * The gateway admits `status_ok = true` and nothing else. Provider admission
 * runs on every write, so a credential whose endpoint or key does not resolve is
 * stored, listed, and completely inert — a state that has no other display
 * anywhere in the product. It is therefore the first column, not a detail.
 *
 * ## Unsealed secrets are reported as findings
 *
 * A write through this platform seals the key into the vault and stores a
 * reference. A row imported from a legacy deployment can still hold a literal,
 * and that value is readable by every holder of the project-scoped configuration
 * permissions on the public project. The server reports `sealed: false` for such
 * a row without ever sending the value, and this panel surfaces it — re-saving
 * the credential is the fix.
 */
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { LlmProviderDialog } from './LlmProviderDialog';
import {
  ConfirmDelete,
  ProviderAlerts,
  ProviderResults,
} from './LlmProviderTableParts';
import { PlatformModelsPanel } from './PlatformModelsPanel';
import { configFailureReason } from './api/adminConfigurationApi';
import { SharedScopeWarning } from './LlmProviderScopeWarning';
import {
  useAdminLlmProviders,
  useCreateAdminLlmProvider,
  useDeleteAdminLlmProvider,
  useUpdateAdminLlmProvider,
  type LlmProvider,
  type LlmProviderDraft,
} from './api/adminLlmProvidersApi';

/** A stable empty list, so a pending query does not invalidate every memo. */
const EMPTY_PROVIDERS: readonly LlmProvider[] = [];

/** The rows holding a secret this platform did not seal. */
function unsealedProviders(items: readonly LlmProvider[]): readonly LlmProvider[] {
  return items.filter((item) => item.secrets.some((secret) => !secret.sealed));
}

export function LlmProxyProvidersPanel(): ReactNode {
  const [editor, setEditor] = useState<{ readonly open: boolean; readonly row: LlmProvider | undefined }>({
    open: false,
    row: undefined,
  });
  const [pendingDelete, setPendingDelete] = useState<LlmProvider | undefined>(undefined);

  const { data, isPending, error } = useAdminLlmProviders();
  const createProvider = useCreateAdminLlmProvider();
  const updateProvider = useUpdateAdminLlmProvider();
  const deleteProvider = useDeleteAdminLlmProvider();

  // Both derived from `data.items`, which is stable between refetches, rather
  // than from a `?? []` fallback that is a fresh array on every render — the
  // dependency that made `useMemo` here recompute unconditionally.
  const items = useMemo(() => data?.items ?? EMPTY_PROVIDERS, [data?.items]);
  const unsealed = useMemo(() => unsealedProviders(items), [items]);

  // The server's own sentence when it gave one — its refusals here name the
  // problem ("not an LLM provider credential type the gateway can dispatch to",
  // a self-referential endpoint), and a generic "failed to save" would discard
  // exactly the words that say what to change.
  const saveFailure = createProvider.error ?? updateProvider.error;
  const saveError =
    saveFailure != null
      ? (configFailureReason(saveFailure) ??
        t('pages.admin.llmProviders.saveError', 'Failed to save the provider.'))
      : undefined;

  const onSubmit = (draft: LlmProviderDraft) => {
    const onSuccess = () => {
      setEditor({ open: false, row: undefined });
    };
    if (editor.row !== undefined) {
      // The TYPE is not resent on an edit: it cannot change (see the dialog),
      // and restating it would make a partial update carry a field the operator
      // did not touch.
      updateProvider.mutate(
        { id: editor.row.id, draft: { elitea_title: draft.elitea_title, data: draft.data } },
        { onSuccess },
      );
      return;
    }
    createProvider.mutate(draft, { onSuccess });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Typography variant="bodySmall" color="text.secondary">
        {t(
          'pages.admin.llmProviders.intro',
          'Provider credentials published here are available to every project on this deployment. A project can still configure its own; both resolve, and a project’s own credential is not replaced by these.',
        )}
      </Typography>

      <SharedScopeWarning publicProjectID={data?.public_project_id ?? 0} />

      <ProviderAlerts
        loadError={error}
        saveError={saveError}
        deleteError={deleteProvider.error}
        unsealed={unsealed}
      />

      <Box sx={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="elitea" color="primary"
          size="small"
          data-testid="llm-providers-add"
          onClick={() => setEditor({ open: true, row: undefined })}
        >
          {t('pages.admin.llmProviders.add', 'Add a platform provider')}
        </Button>
        {data !== undefined && data.public_project_id > 0 ? (
          // Echoed because getting it wrong is the failure where every
          // credential is published correctly into a schema the gateway never
          // reads, and every other signal on this screen still looks right.
          <Typography variant="bodySmall" color="text.secondary">
            {t('pages.admin.llmProviders.publicProject', 'Shared project: {{id}}', {
              id: data.public_project_id,
            })}
          </Typography>
        ) : null}
      </Box>

      <ProviderResults
        isPending={isPending}
        failed={error != null}
        items={items}
        onEdit={(row) => setEditor({ open: true, row })}
        onDelete={setPendingDelete}
      />

      <ConfirmDelete
        provider={pendingDelete}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={(row) => {
          deleteProvider.mutate(row.id, { onSuccess: () => setPendingDelete(undefined) });
        }}
      />

      {/* Models sit under the providers on the SAME tab. A model names a
          credential, and the commonest mistake is a model naming one that is
          not there — two screens would put the cause and the effect a click
          apart. */}
      <Divider sx={{ marginTop: '0.5rem' }} />
      <PlatformModelsPanel />

      <LlmProviderDialog
        open={editor.open}
        providerTypes={data?.provider_types ?? []}
        editing={editor.row}
        isSaving={createProvider.isPending || updateProvider.isPending}
        serverError={saveError}
        onClose={() => {
          setEditor({ open: false, row: undefined });
          // The previous refusal is DISCARDED on close. Both mutations keep
          // their error until the next mutate(), so without this a failure from
          // one row would still be at the top of the dialog when the operator
          // opened a different one.
          createProvider.reset();
          updateProvider.reset();
        }}
        onSubmit={onSubmit}
      />
    </Box>
  );
}
