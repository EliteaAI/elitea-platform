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

import { useWikiList, WikiList, WikiPageView } from '@/features/wiki-browser';
import type { RepositoryIdentity, ToolkitSettings, WikiManifest } from '@/entities/wiki';
import {
  DeleteWikiButton,
  WikiChatDrawer,
  WikiGenerationPanel,
  WikiPageEditor,
  WikiPageReader,
  WikiSettingsPanel,
  type WikiChatTarget,
} from '@/widgets/deepwiki';
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
  /** The toolkit row as last read — the settings PUT replaces the whole resource. */
  readonly toolkit?: Record<string, unknown>;
}

export function DeepWiki({
  projectId,
  identity,
  toolkitId,
  settings,
  toolkit,
}: DeepWikiProps): React.JSX.Element | null {
  const [selected, setSelected] = useState<WikiManifest | undefined>(undefined);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState<{ pageKey: string; markdown: string } | null>(null);
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

  const chatTarget = chatTargetFor(projectId, toolkitId, settings, identity);
  const open = selected ?? query.data.wikis[0];

  return (
    <Box>
      <ToolkitControls
        projectId={projectId}
        toolkitId={toolkitId}
        settings={settings}
        toolkit={toolkit}
        hasWiki={open !== undefined}
        settingsOpen={settingsOpen}
        onToggleSettings={() => { setSettingsOpen((v) => !v); }}
        chatAvailable={chatTarget !== null}
        onOpenChat={() => { setChatOpen(true); }}
      />

      <WikiList
        wikis={query.data.wikis}
        allWikis={query.data.allWikis}
        selectedWikiId={selected?.wiki_id}
        onSelect={setSelected}
      />

      {/* The first wiki is opened by default. A list that needs a click before
          it shows anything reads as an empty screen on a project with one
          wiki, which is the common case. */}
      {open === undefined ? null : (
        <ReaderArea
          projectId={projectId}
          wiki={open}
          onDeleted={() => { setSelected(undefined); }}
          onEdit={(pageKey, markdown) => { setEditing({ pageKey, markdown }); }}
        />
      )}

      {editing === null ? null : (
        <WikiPageEditor
          open
          onClose={() => { setEditing(null); }}
          projectId={projectId}
          pageKey={editing.pageKey}
          markdown={editing.markdown}
        />
      )}

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

interface ToolkitControlsProps {
  readonly projectId: string;
  readonly toolkitId: string | undefined;
  readonly settings: ToolkitSettings | undefined;
  readonly toolkit: Record<string, unknown> | undefined;
  readonly hasWiki: boolean;
  readonly settingsOpen: boolean;
  readonly onToggleSettings: () => void;
  readonly chatAvailable: boolean;
  readonly onOpenChat: () => void;
}

/** The toolbar and the two toolkit-level panels: generation and settings. */
function ToolkitControls({
  projectId,
  toolkitId,
  settings,
  toolkit,
  hasWiki,
  settingsOpen,
  onToggleSettings,
  chatAvailable,
  onOpenChat,
}: ToolkitControlsProps): React.JSX.Element {
  const hasToolkit = toolkitId !== undefined && settings !== undefined;
  return (
    <>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1 }} />
        {hasToolkit ? (
          <Button size="small" variant="text" onClick={onToggleSettings} data-testid="wiki-settings-toggle">
            {settingsOpen ? t('deepwiki.settings.hide', 'Hide settings') : t('deepwiki.settings.show', 'Settings')}
          </Button>
        ) : null}
        {chatAvailable ? (
          <Button size="small" variant="outlined" onClick={onOpenChat}>
            {t('deepwiki.openChat', 'Ask about this repository')}
          </Button>
        ) : null}
      </Stack>

      {hasToolkit && settingsOpen && toolkit !== undefined ? (
        <Box sx={{ mb: 2 }}>
          <WikiSettingsPanel projectId={projectId} toolkitId={toolkitId} toolkit={toolkit} settings={settings} />
        </Box>
      ) : null}

      {hasToolkit ? (
        <Box sx={{ mb: 2 }}>
          <WikiGenerationPanel projectId={projectId} toolkitId={toolkitId} settings={settings} hasWiki={hasWiki} />
        </Box>
      ) : null}
    </>
  );
}

interface ReaderAreaProps {
  readonly projectId: string;
  readonly wiki: WikiManifest;
  readonly onDeleted: () => void;
  readonly onEdit: (pageKey: string, markdown: string) => void;
}

/** The selected wiki: delete, and its pages rendered with the quick fix. */
function ReaderArea({ projectId, wiki, onDeleted, onEdit }: ReaderAreaProps): React.JSX.Element {
  return (
    <Box sx={{ mt: 1 }}>
      <Stack sx={{ flexDirection: 'row', gap: 1, mb: 1 }}>
        <DeleteWikiButton projectId={projectId} wiki={wiki} onDeleted={onDeleted} />
      </Stack>
      <WikiPageView
        projectId={projectId}
        wiki={wiki}
        renderContent={(markdown, pageKey) => (
          <Box>
            <Stack sx={{ flexDirection: 'row', justifyContent: 'flex-end', mb: 0.5 }}>
              <Button size="small" onClick={() => { onEdit(pageKey, markdown); }} data-testid="wiki-page-edit">
                {t('deepwiki.editor.open', 'Edit page')}
              </Button>
            </Stack>
            <WikiPageReader projectId={projectId} pageKey={pageKey} markdown={markdown} />
          </Box>
        )}
      />
    </Box>
  );
}

/**
 * The chat needs a toolkit to ask THROUGH: its settings carry the model and
 * the repository the question is about. A route that has not resolved one
 * renders the browser and no chat rather than a chat that cannot send.
 */
function chatTargetFor(
  projectId: string,
  toolkitId: string | undefined,
  settings: ToolkitSettings | undefined,
  identity: RepositoryIdentity | null,
): WikiChatTarget | null {
  if (toolkitId === undefined || settings === undefined) return null;
  return {
    projectId: Number(projectId),
    toolkitId: Number(toolkitId),
    toolkitName: WIKI_TOOLKIT_NAME,
    toolkitType: WIKI_TOOLKIT_NAME,
    settings,
    repoIdentifierOverride: identity?.repository ?? undefined,
  };
}
