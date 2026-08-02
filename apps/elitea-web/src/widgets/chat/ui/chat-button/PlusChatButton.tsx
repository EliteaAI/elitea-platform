import { memo, useCallback, useRef, useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import type { Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import PlusChatSubmenu from './PlusChatSubmenu';

/**
 * Chat button primitive: PlusChatButton
 *
 * A "+" icon button that opens a dropdown menu for adding agents, pipelines,
 * toolkits, and other chat enhancements. When a menu item is clicked it opens
 * the corresponding `PlusChatSubmenu` for the user to pick from the available
 * items (with search and create-new support).
 *
 * Prop contract (injected by the composition root through `slots.attachmentButton` / the footer row):
 *   - `onAttachFiles`                — pass-through to the attachment submenu
 *   - `disableAttachments`           — pass-through to the attachment submenu
 *   - `attachments`                  — pass-through to the attachment submenu
 *   - `limits`                       — pass-through to the attachment submenu
 *   - `onInternalToolsConfigChange`  — pass-through for tools config
 *   - `internal_tools`               — pass-through for tools config
 *   - `onCreateAgent`                — navigate/create an agent
 *   - `onCreatePipeline`             — navigate/create a pipeline
 *   - `onCreateToolkit`              — navigate/create a toolkit (optional `isMcp`)
 *   - `participants`                 — list of participants for agent selection
 */
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
}

interface MenuItemDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  submenu?: 'agents' | 'pipelines' | 'toolkits' | 'attachments' | 'tools';
}

const MENU_ITEMS: MenuItemDef[] = [
  { key: 'agents', label: 'Agents', icon: '🤖', submenu: 'agents' },
  { key: 'pipelines', label: 'Pipelines', icon: '📊', submenu: 'pipelines' },
  { key: 'toolkits', label: 'Toolkits', icon: '🧰', submenu: 'toolkits' },
  { key: 'attachments', label: 'Attachments', icon: '📎', submenu: 'attachments' },
  { key: 'tools', label: 'Tools', icon: '⚙️', submenu: 'tools' },
];

export const PlusChatButton = memo(
  ({
    onAttachFiles: _onAttachFiles,
    disableAttachments: _disableAttachments,
    attachments,
    limits: _limits,
    onInternalToolsConfigChange: _onInternalToolsConfigChange,
    internal_tools,
    onCreateAgent,
    onCreatePipeline,
    onCreateToolkit,
    participants,
  }: PlusChatButtonProps) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
    const [searchValue, setSearchValue] = useState('');
    const anchorRef = useRef<HTMLButtonElement>(null);

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

    const handleSubmenuOpen = useCallback((key: string) => {
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

    // Build submenu items based on the active submenu
    const submenuItems = activeSubmenu
      ? (() => {
          switch (activeSubmenu) {
            case 'agents':
              return (participants ?? []).map((p, i) => ({
                key: `agent-${i}`,
                label: (p as { name?: string })?.name ?? `Agent ${i + 1}`,
              }));
            case 'pipelines':
              return [{ key: 'pipeline-1', label: 'No pipelines configured' }];
            case 'toolkits':
              return [{ key: 'toolkit-1', label: 'No toolkits configured' }];
            case 'attachments':
              return attachments && attachments.length > 0
                ? attachments.map((f, i) => ({
                    key: `attach-${i}`,
                    label: f.name,
                  }))
                : [{ key: 'no-attachments', label: 'No files attached' }];
            case 'tools':
              return (internal_tools ?? []).map((t, i) => ({
                key: `tool-${i}`,
                label: t,
              }));
            default:
              return [];
          }
        })()
      : [];

    return (
      <>
        <Tooltip title="Add files, agents, toolkits and more..." placement="top">
          <IconButton
            ref={anchorRef}
            color="secondary"
            aria-label="plus menu"
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
                borderRadius: '0.75rem',
                border: '0.0625rem solid',
                borderColor: 'border.lines',
                background: theme.vars.palette.background.secondary,
                padding: 0,
                overflow: 'hidden',
              })}
            >
              {/* Main menu or submenu */}
              {activeSubmenu ? (
                <PlusChatSubmenu
                  items={submenuItems}
                  searchValue={searchValue}
                  onSearchChange={(e) => setSearchValue(e.target.value)}
                  searchPlaceholder="Search..."
                  showCreateNew={
                    activeSubmenu === 'agents' ||
                    activeSubmenu === 'pipelines' ||
                    activeSubmenu === 'toolkits'
                  }
                  onCreateNew={
                    activeSubmenu === 'agents'
                      ? handleCreateAgent
                      : activeSubmenu === 'pipelines'
                        ? handleCreatePipeline
                        : activeSubmenu === 'toolkits'
                          ? handleCreateToolkit
                          : undefined
                  }
                  createNewLabel="Create new"
                  emptyMessage={`No ${activeSubmenu} available`}
                  noResultsMessage="No items found"
                  isLoading={false}
                />
              ) : (
                <Box>
                  {/* Back button header */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      padding: '0.5rem 1rem',
                      borderBottom: '0.0625rem solid',
                      borderColor: 'border.lines',
                      cursor: 'pointer',
                      color: 'text.secondary',
                    }}
                    onClick={handleBack}
                  >
                    <Typography variant="bodyMedium" sx={{ flex: 1 }}>
                      Add to chat
                    </Typography>
                  </Box>

                  {/* Menu items */}
                  {MENU_ITEMS.map((item) => (
                    <Box
                      key={item.key}
                      role="menuitem"
                      tabIndex={0}
                      sx={(theme: Theme) => ({
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        padding: '0.5rem 1rem',
                        height: '2.75rem',
                        cursor: 'pointer',
                        color: theme.vars.palette.text.secondary,
                        '&:hover': {
                          backgroundColor: theme.vars.palette.action.hover,
                        },
                      })}
                      onClick={() => item.submenu && handleSubmenuOpen(item.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (item.submenu) handleSubmenuOpen(item.key);
                        }
                      }}
                    >
                      <Typography sx={{ flex: 1, fontSize: '0.875rem', lineHeight: '1.5rem' }}>
                        {item.label}
                      </Typography>
                      <Box
                        sx={(theme: Theme) => ({
                          opacity: 0.5,
                          fontSize: '0.75rem',
                          color: theme.vars.palette.text.disabled,
                        })}
                      >
                        ›
                      </Box>
                    </Box>
                  ))}
                </Box>
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
