/**
 * DWIKI-001 `/deepwiki` — the native wiki browser.
 *
 * The page reads params and permission, renders error and pending, and
 * composes. It does not fetch: that is `features/wiki-browser`'s model, per
 * spec §3 (a page that fetches is a page that cannot be reused).
 *
 * BEHIND `BackendCapability.deepwiki`, WHICH IS OFF. The routes this feature
 * calls are served, and the feature still cannot work end to end, because the
 * PROVIDER writes wiki content through a path family elitea-main serves no
 * route in (parity/notes/deepwiki-artifact-store.md, issue #665). Rendering the
 * browser today would list nothing, on a screen with no way to tell that from
 * "you have not generated a wiki yet". So the flag stays off until the provider
 * writes where this reads, and every change up to then is shippable and tested
 * while invisible.
 */
import { useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { useWikiList, WikiList } from '@/features/wiki-browser';
import type { RepositoryIdentity, WikiManifest } from '@/entities/wiki';
import { hasBackendCapability } from '@/shared/config/backendCapabilities';
import { t } from '@/shared/i18n';

export interface DeepWikiProps {
  /** The project whose wikis are shown. */
  readonly projectId: string;
  /**
   * The repository this project's DeepWiki toolkit is configured for.
   *
   * Passed in rather than resolved here: resolving it needs the toolkit, and
   * following a code-toolkit reference is a second request. The settings
   * feature owns both (DWIKI-010).
   */
  readonly identity: RepositoryIdentity | null;
}

export function DeepWiki({ projectId, identity }: DeepWikiProps): React.JSX.Element | null {
  const [selected, setSelected] = useState<WikiManifest | undefined>(undefined);
  const enabled = hasBackendCapability('deepwiki');
  const query = useWikiList(projectId, identity, { enabled });

  if (!enabled) return null;

  if (query.isPending) {
    return <Typography variant="body2">{t('deepwiki.loading', 'Loading wikis…')}</Typography>;
  }
  if (query.isError) {
    return (
      <Typography variant="body2" color="error">
        {t('deepwiki.loadFailed', 'The wikis for this project could not be loaded.')}
      </Typography>
    );
  }

  return (
    <Box>
      <WikiList
        wikis={query.data.wikis}
        allWikis={query.data.allWikis}
        selectedWikiId={selected?.wiki_id}
        onSelect={setSelected}
      />
    </Box>
  );
}
