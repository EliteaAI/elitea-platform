import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import type { SxProps, Theme } from '@mui/material/styles';

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
import { AnimatedLoadingText } from '@/shared/ui/AnimatedLoadingText';
import { BannerMessage } from '@/shared/ui/BannerMessage';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BaseTab } from '@/shared/ui/BaseTab';
import { BaseTabs } from '@/shared/ui/BaseTabs';

/** The provider's toolkit name — the SPI addresses it lowercased. */
const WIKI_TOOLKIT_NAME = 'wikis';

/**
 * The app's page recipe (pages/toolkits/Toolkits.tsx): the page owns its
 * height, its header bar and its scroll container, because the shell's
 * <main> supplies none of them and native scrollbars are hidden app-wide —
 * a page without `overflowY: 'auto'` here could not be scrolled at all.
 */
const pageSx: SxProps<Theme> = { height: '100%', display: 'flex', flexDirection: 'column' };
const tabBarSx: SxProps<Theme> = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  borderBottom: 1,
  borderColor: 'divider',
  padding: '0 1.5rem',
};
const panelsSx: SxProps<Theme> = { flexShrink: 0, gap: 2, padding: '1rem 1.5rem 0' };
const tabPanelSx: SxProps<Theme> = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.5rem' };

export interface DeepWikiProps {
  readonly projectId: string;
  readonly identity: RepositoryIdentity | null;
  readonly toolkitId?: string;
  readonly settings?: ToolkitSettings;
  /** The toolkit row as last read; the settings panel PUTs the whole of it back. */
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
    return (
      <Box sx={tabPanelSx}>
        <AnimatedLoadingText text={t('deepwiki.loading', 'Loading wikis…')} />
      </Box>
    );
  }
  if (query.isError) {
    return (
      <Box sx={tabPanelSx}>
        <BannerMessage
          variant="error"
          message={t('deepwiki.loadFailed', 'The wikis for this project could not be loaded.')}
        />
      </Box>
    );
  }

  const chatTarget = chatTargetFor(projectId, toolkitId, settings, identity);
  // The first wiki is opened by default. A list that needs a click before it
  // shows anything reads as an empty screen on a project with one wiki, which
  // is the common case.
  const open = selected ?? query.data.wikis[0];

  return (
    <Box sx={pageSx}>
      <ToolkitControls
        projectId={projectId}
        toolkitId={toolkitId}
        settings={settings}
        toolkit={toolkit}
        hasWiki={open !== undefined}
        settingsOpen={settingsOpen}
        onToggleSettings={() => {
          setSettingsOpen((v) => !v);
        }}
        chatAvailable={chatTarget !== null}
        onOpenChat={() => {
          setChatOpen(true);
        }}
      />
      <Box sx={tabPanelSx}>
        <WikiList
          wikis={query.data.wikis}
          allWikis={query.data.allWikis}
          selectedWikiId={selected?.wiki_id}
          onSelect={setSelected}
        />
        {open === undefined ? null : (
          <ReaderArea
            projectId={projectId}
            wiki={open}
            onDeleted={() => {
              setSelected(undefined);
            }}
            onEdit={(pageKey, markdown) => {
              setEditing({ pageKey, markdown });
            }}
          />
        )}
      </Box>
      {editing === null ? null : (
        <WikiPageEditor
          open
          onClose={() => {
            setEditing(null);
          }}
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

/** The header bar — the page's name and its actions — and the panels under it. */
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
      <Box sx={tabBarSx}>
        <BaseTabs value={0} sx={{ flex: 1 }}>
          <BaseTab label={t('deepwiki.title', 'Wiki')} />
        </BaseTabs>
        {hasToolkit ? (
          <BaseBtn variant="tertiary" size="small" onClick={onToggleSettings} data-testid="wiki-settings-toggle">
            {settingsOpen ? t('deepwiki.settings.hide', 'Hide settings') : t('deepwiki.settings.show', 'Settings')}
          </BaseBtn>
        ) : null}
        {chatAvailable ? (
          <BaseBtn variant="secondary" size="small" onClick={onOpenChat}>
            {t('deepwiki.openChat', 'Ask about this repository')}
          </BaseBtn>
        ) : null}
      </Box>
      {hasToolkit ? (
        <Stack sx={panelsSx}>
          {settingsOpen && toolkit !== undefined ? (
            <WikiSettingsPanel projectId={projectId} toolkitId={toolkitId} toolkit={toolkit} settings={settings} />
          ) : null}
          <WikiGenerationPanel projectId={projectId} toolkitId={toolkitId} settings={settings} hasWiki={hasWiki} />
        </Stack>
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
              <BaseBtn
                variant="tertiary"
                size="small"
                onClick={() => {
                  onEdit(pageKey, markdown);
                }}
                data-testid="wiki-page-edit"
              >
                {t('deepwiki.editor.open', 'Edit page')}
              </BaseBtn>
            </Stack>
            <WikiPageReader projectId={projectId} pageKey={pageKey} markdown={markdown} />
          </Box>
        )}
      />
    </Box>
  );
}

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
