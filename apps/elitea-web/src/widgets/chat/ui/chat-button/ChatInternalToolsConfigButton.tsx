import { memo, useCallback, useRef, useState } from 'react';

import ClickAwayListener from '@mui/material/ClickAwayListener';
import SettingsIcon from '@mui/icons-material/Settings';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import type { Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

/**
 * Chat button primitive: ChatInternalToolsConfigButton
 *
 * Renders a settings / gear icon button that opens a popper with toggles for
 * internal chat tools (e.g. web search, code interpreter, file upload).
 * Each toggle is a checkbox that calls `onInternalToolsConfigChange` when
 * switched.
 *
 * Prop contract (injected by the composition root through `slots.internalToolsConfig`):
 *   - `disabled` — disable the settings button
 *
 * Internal state:
 *   - Tool toggles are stored locally; each toggle fires the
 *     `onInternalToolsConfigChange` callback on change.
 *
 * Composition-root integration:
 *   - The consumer passes an `internal_tools` list to PlusChatButton; this
 *     button only exposes the config UI. Actual tool wiring is done by the
 *     composition root in the conversation pipeline.
 */
export interface ChatInternalToolsConfigButtonProps {
  disabled?: boolean;
  /** Tool toggle configuration — key/value pairs that the consumer can persist. */
  tools?: { key: string; label: string; enabled: boolean }[];
  /** Callback invoked when a tool toggle changes. */
  onToolChange?: (toolKey: string, enabled: boolean) => void;
}

/** Default tool definitions used when no `tools` prop is supplied. */
const DEFAULT_TOOLS: { key: string; label: string }[] = [
  { key: 'web_search', label: 'Web Search' },
  { key: 'code_interpreter', label: 'Code Interpreter' },
  { key: 'file_upload', label: 'File Upload' },
  { key: 'image_generation', label: 'Image Generation' },
];

export const ChatInternalToolsConfigButton = memo(
  ({ disabled = false, tools, onToolChange }: ChatInternalToolsConfigButtonProps) => {
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    const isOpen = anchorEl !== null;

    const toggleMenu = useCallback(() => {
      setAnchorEl((prev) => (prev ? null : buttonRef.current));
    }, []);

    const closeMenu = useCallback(() => {
      setAnchorEl(null);
    }, []);

    // Resolve tool list: use provided tools or fall back to defaults (all enabled)
    const resolvedTools = tools ?? DEFAULT_TOOLS.map((t) => ({ ...t, enabled: true }));

    const handleToolToggle = useCallback(
      (toolKey: string, enabled: boolean) => {
        onToolChange?.(toolKey, enabled);
      },
      [onToolChange],
    );

    return (
      <>
        <Tooltip title="Tools" placement="top">
          <IconButton
            ref={buttonRef}
            color="secondary"
            aria-label="internal tools config"
            onClick={toggleMenu}
            disabled={disabled}
            sx={{ marginLeft: 0 }}
          >
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Popper
          open={isOpen}
          anchorEl={anchorEl}
          placement="top-end"
          sx={{ zIndex: 9998 }}
        >
          <ClickAwayListener onClickAway={closeMenu}>
            <Paper
              elevation={8}
              sx={(theme: Theme) => ({
                minWidth: '14rem',
                borderRadius: '0.5rem',
                border: '0.0625rem solid',
                borderColor: 'border.lines',
                boxShadow: theme.vars.palette.boxShadow.default,
                background: theme.vars.palette.background.secondary,
                padding: '0.25rem 0',
              })}
            >
              <MenuList sx={{ padding: 0 }}>
                {resolvedTools.map((tool) => (
                  <MenuItem
                    key={tool.key}
                    onClick={() => handleToolToggle(tool.key, !tool.enabled)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      padding: '0.375rem 1rem',
                      height: '2.25rem',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                      },
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={tool.enabled}
                      onChange={() => handleToolToggle(tool.key, !tool.enabled)}
                      onClick={(e) => e.stopPropagation()}
                      sx={{
                        '&.MuiCheckbox-root': { padding: 0.25 },
                        '& .MuiSvgIcon-root': { fontSize: '1rem' },
                      }}
                    />
                    <ListItemText
                      primary={
                        <Typography
                          variant="bodySmall"
                          sx={{
                            fontSize: '0.8125rem',
                            lineHeight: '1.375rem',
                            color: 'text.secondary',
                          }}
                        >
                          {tool.label}
                        </Typography>
                      }
                    />
                  </MenuItem>
                ))}
              </MenuList>
            </Paper>
          </ClickAwayListener>
        </Popper>
      </>
    );
  },
);

ChatInternalToolsConfigButton.displayName = 'ChatInternalToolsConfigButton';

export default ChatInternalToolsConfigButton;
