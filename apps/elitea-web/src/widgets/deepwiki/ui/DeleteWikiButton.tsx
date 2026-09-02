/**
 * Delete a wiki and every object under it (DWIKI-011).
 *
 * ONE batchDelete over every key that starts with `{wiki_id}/`, manifest
 * included. The legacy screen deleted one artifact at a time and counted
 * successes into a sentence, so a partial failure left a half-deleted wiki that
 * still listed. Here the keys the server could not delete are shown BY NAME —
 * a partial result is a fact the operator has to act on, not a success count.
 */
import { useState } from 'react';

import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { listWikiObjects, type WikiManifest } from '@/entities/wiki';
import { useDeleteWiki, type DeleteWikiResult } from '@/features/wiki-settings';
import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';

interface DeleteWikiButtonProps {
  readonly projectId: string | number;
  readonly wiki: WikiManifest;
  readonly onDeleted?: () => void;
}

export function DeleteWikiButton({ projectId, wiki, onDeleted }: DeleteWikiButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<DeleteWikiResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const remove = useDeleteWiki();
  const wikiId = wiki.wiki_id ?? '';

  const confirm = async (): Promise<void> => {
    setFailure(null);
    try {
      // The key set is READ AT DELETE TIME, not taken from the manifest: a
      // manifest lists pages, and a wiki also holds analysis files, older
      // manifests and a repository context that the manifest does not name.
      const objects = await listWikiObjects(projectId);
      const keys = objects.map((o) => o.key).filter((key) => key.startsWith(`${wikiId}/`));
      const outcome = await remove.mutateAsync({ projectId, keys });
      setResult(outcome);
      setOpen(false);
      if (outcome.failed.length === 0) onDeleted?.();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
      setOpen(false);
    }
  };

  return (
    <Stack sx={{ gap: 1 }}>
      <BaseBtn variant="alarm" size="small" onClick={() => { setOpen(true); }} disabled={wikiId === ''} data-testid="wiki-delete">
        {t('deepwiki.delete.button', 'Delete wiki')}
      </BaseBtn>
      {failure === null ? null : (
        <Alert severity="error" data-testid="wiki-delete-error">{failure}</Alert>
      )}
      {result !== null && result.failed.length > 0 ? (
        <Alert severity="warning" data-testid="wiki-delete-partial">
          <Typography variant="bodySmall">
            {t('deepwiki.delete.partial', '{{deleted}} object(s) deleted; these remain:', { deleted: String(result.deleted) })}
          </Typography>
          <Stack component="ul" sx={{ gap: 0.25, m: 0, pl: 2 }}>
            {result.failed.map((key) => (
              <Typography key={key} component="li" variant="bodySmall">
                {key}
              </Typography>
            ))}
          </Stack>
        </Alert>
      ) : null}
      <DeleteEntityModal
        open={open}
        onClose={() => { setOpen(false); }}
        onConfirm={() => void confirm()}
        name={wiki.wiki_title ?? wikiId}
        confirming={remove.isPending}
      />
    </Stack>
  );
}
