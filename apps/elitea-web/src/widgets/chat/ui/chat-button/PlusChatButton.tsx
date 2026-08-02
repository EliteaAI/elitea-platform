import { memo, useCallback, useRef, useState } from 'react';

import {
  Box,
  ClickAwayListener,
  IconButton,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';

/**
 * Phase-2 Chat button primitive: PlusChatButton
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
const PlusChatButton = memo(
  (_props: {
    onAttachFiles?: (files: File | File[]) => void;
    disableAttachments?: boolean;
    attachments?: File[];
    limits?: Record<string, number>;
    onInternalToolsConfigChange?: (config: { key: string; value: boolean }) => void;
    internal_tools?: string[];
    onCreateAgent?: () => void;
    onCreatePipeline?: () => void;
    onCreateToolkit?: (isMcp?: boolean) => void;
    participants?: unknown[];
  }) => {
    const theme = useTheme();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [isOpen, setIsOpen] = useState(false);

    const handleClose = useCallback(() => setIsOpen(false), []);

    return (
      <>
        <Tooltip title="Add files, agents, toolkits and more..." placement="top">
          <IconButton
            ref={buttonRef}
            color="secondary"
            aria-label="plus menu"
            data-testid="plus-menu-button"
            onClick={() => setIsOpen(prev => !prev)}
          >
            <Box component="span" sx={{ fontSize: '1rem' }}>
              +
            </Box>
          </IconButton>
        </Tooltip>

        <Popper
          open={isOpen}
          anchorEl={buttonRef.current}
          placement="bottom-start"
          style={{ zIndex: 9998 }}
        >
          <ClickAwayListener onClickAway={handleClose}>
            <Paper
              elevation={8}
              sx={{
                minWidth: '15.125rem',
                borderRadius: '.75rem',
                border: `.0625rem solid ${theme.palette.border.lines}`,
                backgroundColor: theme.palette.background.secondary,
                padding: 0,
                overflow: 'hidden',
              }}
            >
              <MenuList sx={{ padding: 0 }}>
                {['Agents', 'Pipelines', 'Toolkits'].map(label => (
                  <MenuItem
                    key={label}
                    onClick={handleClose}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '.75rem',
                      padding: '.5rem 1rem',
                      height: '2.75rem',
                      color: theme.palette.text.secondary,
                    }}
                  >
                    <Typography sx={{ flex: 1, fontSize: '.875rem', lineHeight: '1.5rem' }}>
                      {label}
                    </Typography>
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

PlusChatButton.displayName = 'PlusChatButton';

export default PlusChatButton;
