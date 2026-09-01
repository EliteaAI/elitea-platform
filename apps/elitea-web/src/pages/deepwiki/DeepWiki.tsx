/**
 * DWIKI-001 `/deepwiki` — the native wiki browser.
 *
 * The page reads params and permission, renders error and pending, and
 * composes. It does not fetch: that is `features/wiki-browser`'s model, per
 * spec §3 (a page that fetches is a page that cannot be reused).
 *
 * BEHIND `BackendCapability.deepwiki`, WHICH IS NOW ON. It was off while the
 * PROVIDER wrote wiki content through a path family elitea-main serves no route
 * in — the browser would have listed nothing, on a screen with no way to tell
 * that from "you have not generated a wiki yet". #665 fixed the provider's
 * client to write where this reads, so the flag flipped with it.
 *
 * WHAT THE FLAG DOES NOT BUY. Generating and chatting need the provider
 * SERVICE to be reachable; a deployment without one lists and reads wikis and
 * refuses to generate. That is a deployment fact, not a capability this flag
 * gates, and the generation surface reports it rather than this page hiding.
 */
import { useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';

import { useWikiList, WikiList } from '@/features/wiki-browser';
import type { RepositoryIdentity, ToolkitSettings, WikiManifest } from '@/entities/wiki';
import { WikiChatDrawer, type WikiChatTarget } from '@/widgets/deepwiki';
import { hasBackendCapability } from '@/shared/config/backendCapabilities';
import { t } from '@/shared/i18n';

/**
 * The provider's own toolkit name, which is what the SPI path carries.
 *
 * `/tools/{toolkit_name}/{tool_name}/invoke` — and the descriptor names this
 * provider's single toolkit `Wikis` (conformance fixture
 * descriptor/legacy-v0/provider_descriptor.json). It is NOT the local toolkit
 * row's name, which a user can rename.
 */
const WIKI_TOOLKIT_NAME = 'wikis';

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
  /**
   * The toolkit this wiki belongs to, and its stored settings.
   *
   * Both optional because the route resolves them and a caller that has not
   * (a test, a future embed) still gets a working browser. What they gate is
   * the CHAT: a question needs a model and a repository to be about, and both
   * live in the settings.
   */
  readonly toolkitId?: string;
  readonly settings?: ToolkitSettings;
}

export function DeepWiki({
  projectId,
  identity,
  toolkitId,
  settings,
}: DeepWikiProps): React.JSX.Element | null {
  const [selected, setSelected] = useState<WikiManifest | undefined>(undefined);
  const [chatOpen, setChatOpen] = useState(false);
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

  // The chat needs a toolkit to ask THROUGH: its settings carry the model and
  // the repository the question is about. A route that has not resolved one
  // renders the browser and no chat rather than a chat that cannot send.
  const chatTarget: WikiChatTarget | null =
    toolkitId === undefined || settings === undefined
      ? null
      : {
          projectId: Number(projectId),
          toolkitId: Number(toolkitId),
          toolkitName: WIKI_TOOLKIT_NAME,
          toolkitType: WIKI_TOOLKIT_NAME,
          settings,
          repoIdentifierOverride: identity?.repository ?? undefined,
        };

  return (
    <Box>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box sx={{ flex: 1 }} />
        {chatTarget === null ? null : (
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setChatOpen(true);
            }}
          >
            {t('deepwiki.openChat', 'Ask about this repository')}
          </Button>
        )}
      </Stack>

      <WikiList
        wikis={query.data.wikis}
        allWikis={query.data.allWikis}
        selectedWikiId={selected?.wiki_id}
        onSelect={setSelected}
      />

      {chatTarget === null ? null : (
        <WikiChatDrawer
          open={chatOpen}
          onClose={() => {
            setChatOpen(false);
          }}
          target={chatTarget}
        />
      )}
    </Box>
  );
}
