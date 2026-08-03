import { memo, useCallback, useRef, useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import type { Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { agentEditorHooks } from '@/features/agents';
import { t } from '@/shared/i18n';

import { AttachmentsPanel, MainMenuList } from './PlusChatButton.parts';
import {
  MENU_ITEMS,
  resolveActiveSubmenuView,
  type PlusChatButtonEntitySubmenus,
  type SubmenuKey,
} from './PlusChatButton.helpers';
import PlusChatSubmenu from './PlusChatSubmenu';

/**
 * Chat button primitive: PlusChatButton
 *
 * A "+" icon button that opens a dropdown menu for adding agents, pipelines,
 * toolkits, MCPs, attachments and internal-tool toggles. Every entity
 * category (agents/pipelines/toolkits/mcps) renders whatever real items the
 * composition root supplies via `entitySubmenus` and calls
 * `entitySubmenus.onSelectParticipant` on click — this widget cannot fetch
 * that data itself: the equivalent of baseline's `useApplicationSubmenu`
 * lives at `processes/chat/model/useChatEntityBrowser.ts`, a layer ABOVE
 * `widgets/` (R-L1 forbids the upward import), so wiring real data in is a
 * later composition-root stage's job, same as `participants` already was.
 * Until that lands, an omitted category just renders its own empty state
 * (`PlusChatSubmenu`'s `emptyMessage`), not fake placeholder rows.
 *
 * "Tools" renders the real internal-tools catalog
 * (`agentEditorHooks.useAvailableInternalTools()`, feature/agents — the
 * same source baseline's `PlusChatButton.jsx` reads directly) with working
 * checkboxes that call `onInternalToolsConfigChange`. "MCPs" is gated by
 * `agentEditorHooks.useIsMcpVisible()`, matching baseline's `isMcpVisible`
 * gate. "Attachments" embeds the real `AttachmentButton` (via
 * `PlusChatButton.parts.tsx`'s `AttachmentsPanel`) wired to the real
 * `onAttachFiles`/`disableAttachments`/`attachments`/`limits` props,
 * instead of discarding them.
 *
 * Split across `PlusChatButton.helpers.ts` (pure submenu-item/create-config
 * logic) and `PlusChatButton.parts.tsx` (the attachments panel + main menu
 * list JSX) purely to keep this file under the §3.5 file-length-400 and
 * cyclomatic-complexity-12 budgets.
 *
 * Prop contract (injected by the composition root through `slots.attachmentButton` / the footer row):
 *   - `onAttachFiles`                — real file-picker callback (also used by the embedded AttachmentButton)
 *   - `disableAttachments`           — disables the attachments row
 *   - `attachments`                  — current attachment list (shown + counted)
 *   - `limits`                       — optional overrides merged onto `ATTACHMENT_LIMITS` (see `AttachmentButton`'s own doc comment)
 *   - `onInternalToolsConfigChange`  — toggles a tool on/off
 *   - `internal_tools`               — currently-enabled tool names
 *   - `onCreateAgent`                — navigate/create an agent
 *   - `onCreatePipeline`             — navigate/create a pipeline
 *   - `onCreateToolkit`              — navigate/create a toolkit (`isMcp` for the MCPs category's "create new")
 *   - `participants`                 — list of participants for agent selection
 *   - `entitySubmenus`               — real pipelines/toolkits/mcps lists + the shared select callback (grouped to stay under the §3.5 12-prop budget)
 */
export type { PlusChatButtonEntitySubmenus } from './PlusChatButton.helpers';

export interface PlusChatButtonProps {
  onAttachFiles?: (files: readonly File[]) => void;
  disableAttachments?: boolean;
  attachments?: readonly File[];
  limits?: Record<string, number>;
  onInternalToolsConfigChange?: (config: { key: string; value: boolean }) => void;
  internal_tools?: string[];
  onCreateAgent?: () => void;
  onCreatePipeline?: () => void;
  onCreateToolkit?: (isMcp?: boolean) => void;
  participants?: unknown[];
  entitySubmenus?: PlusChatButtonEntitySubmenus;
}

export const PlusChatButton = memo(
  ({
    onAttachFiles = () => {},
    disableAttachments = false,
    attachments = [],
    limits = {},
    onInternalToolsConfigChange,
    internal_tools,
    onCreateAgent,
    onCreatePipeline,
    onCreateToolkit,
    participants,
    entitySubmenus,
  }: PlusChatButtonProps) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [activeSubmenu, setActiveSubmenu] = useState<SubmenuKey | null>(null);
    const [searchValue, setSearchValue] = useState('');
    const anchorRef = useRef<HTMLButtonElement>(null);

    const availableTools = agentEditorHooks.useAvailableInternalTools();
    const isMcpVisible = agentEditorHooks.useIsMcpVisible();

    const toggleMenu = useCallback(() => {
      setMenuOpen((prev) => !prev);
      if (activeSubmenu) {
        setActiveSubmenu(null);
      }
    }, [activeSubmenu]);

    const closeMenu = useCallback(() => {
      setMenuOpen(false);
      setActiveSubmenu(null);
      setSearchValue('');
    }, []);

    const handleSubmenuOpen = useCallback((key: SubmenuKey) => {
      setActiveSubmenu(key);
    }, []);

    const handleBack = useCallback(() => {
      setActiveSubmenu(null);
      setSearchValue('');
    }, []);

    const handleCreateAgent = useCallback(() => {
      onCreateAgent?.();
      closeMenu();
    }, [onCreateAgent, closeMenu]);

    const handleCreatePipeline = useCallback(() => {
      onCreatePipeline?.();
      closeMenu();
    }, [onCreatePipeline, closeMenu]);

    const handleCreateToolkit = useCallback(() => {
      onCreateToolkit?.();
      closeMenu();
    }, [onCreateToolkit, closeMenu]);

    const handleCreateMcp = useCallback(() => {
      onCreateToolkit?.(true);
      closeMenu();
    }, [onCreateToolkit, closeMenu]);

    const handleSelectParticipant = useCallback(
      (participant: unknown) => {
        entitySubmenus?.onSelectParticipant?.(participant);
        closeMenu();
      },
      [entitySubmenus, closeMenu],
    );

    const { items: submenuItems, createConfig } = resolveActiveSubmenuView(activeSubmenu, {
      participants,
      entities: entitySubmenus,
      availableTools,
      enabledToolNames: internal_tools,
      onInternalToolsConfigChange,
      onSelect: handleSelectParticipant,
      onCreate: {
        agents: handleCreateAgent,
        pipelines: handleCreatePipeline,
        toolkits: handleCreateToolkit,
        mcps: handleCreateMcp,
      },
    });

    const visibleMenuItems = MENU_ITEMS.filter((item) => item.key !== 'mcps' || isMcpVisible);

    return (
      <>
        <Tooltip title={t('widgets.chat.plusChatButton.tooltip', 'Add files, agents, toolkits and more...')} placement="top">
          <IconButton
            ref={anchorRef}
            color="secondary"
            aria-label={t('widgets.chat.plusChatButton.ariaLabel', 'plus menu')}
            data-testid="plus-menu-button"
            onClick={toggleMenu}
            sx={{ marginLeft: 0 }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Popper
          open={menuOpen}
          anchorEl={anchorRef.current}
          placement="bottom-start"
          sx={{ zIndex: 9998 }}
        >
          <ClickAwayListener onClickAway={closeMenu}>
            <Paper
              elevation={8}
              sx={(theme: Theme) => ({
                minWidth: '17.5rem',
                borderRadius: theme.vars.shape.radiusMd,
                border: '0.0625rem solid',
                borderColor: 'border.lines',
                background: theme.vars.palette.background.secondary,
                padding: 0,
                overflow: 'hidden',
              })}
            >
              {/* Main menu or submenu */}
              {activeSubmenu === 'attachments' ? (
                <AttachmentsPanel
                  disableAttachments={disableAttachments}
                  attachments={attachments}
                  onAttachFiles={onAttachFiles}
                  limits={limits}
                />
              ) : activeSubmenu ? (
                <PlusChatSubmenu
                  items={submenuItems}
                  searchValue={searchValue}
                  onSearchChange={(e) => setSearchValue(e.target.value)}
                  searchPlaceholder={t('widgets.chat.plusChatButton.searchPlaceholder', 'Search...')}
                  showCreateNew={createConfig?.showCreateNew ?? false}
                  onCreateNew={createConfig?.onCreateNew}
                  createNewLabel={t('widgets.chat.plusChatButton.createNewLabel', 'Create new')}
                  emptyMessage={t('widgets.chat.plusChatButton.noItemsAvailable', 'No {{submenu}} available', { submenu: activeSubmenu })}
                  noResultsMessage={t('widgets.chat.plusChatButton.noItemsFound', 'No items found')}
                  isLoading={false}
                />
              ) : (
                <MainMenuList items={visibleMenuItems} onBack={handleBack} onSelectSubmenu={handleSubmenuOpen} />
              )}
            </Paper>
          </ClickAwayListener>
        </Popper>
      </>
    );
  },
);

PlusChatButton.displayName = 'PlusChatButton';

export default PlusChatButton;
