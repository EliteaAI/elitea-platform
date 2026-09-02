/**
 * A right-anchored drawer the user can drag wider.
 *
 * Generic on purpose: it knows nothing about what it holds. The DeepWiki chat
 * is its first consumer and the resize arithmetic lives in `useDrawerResize`,
 * which is where the behaviour is tested.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';

import { useDrawerResize } from './useDrawerResize';

/**
 * How far one arrow-key press moves the edge.
 *
 * ArrowLeft WIDENS, because the drawer is anchored right and the edge the user
 * is holding moves left as it grows — the key matches the direction the handle
 * travels, not the direction the number goes.
 */
const KEYBOARD_STEP_PX = 24;

export interface ResizableDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly initialWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly 'aria-label': string;
  readonly 'data-testid'?: string;
}

export function ResizableDrawer({
  open,
  onClose,
  children,
  initialWidth,
  minWidth,
  maxWidth,
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: ResizableDrawerProps) {
  const { width, isResizing, startResize, nudge } = useDrawerResize({
    initialWidth,
    minWidth,
    maxWidth,
  });

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="persistent"
      slotProps={{
        paper: {
          'aria-label': ariaLabel,
          // `data-*` is not on the Paper slot's prop type, and spreading it in
          // is how the attribute still reaches the DOM. Keeping it on the PAPER
          // rather than on the Drawer root matters: `variant="persistent"`
          // renders the root even when closed, so a testid there would resolve
          // to a hidden element and every "is the drawer open" assertion would
          // pass whether it was or not.
          ...(dataTestId === undefined ? {} : { 'data-testid': dataTestId }),
          sx: {
            width,
            display: 'flex',
            flexDirection: 'column',
            // The transition is dropped WHILE dragging: an animated width
            // lags the pointer and the handle visibly detaches from the edge.
            transition: isResizing ? 'none' : undefined,
          },
        },
      }}
    >
      {/*
        The ARIA window-splitter pattern: a focusable separator carrying its
        current value, driven by the arrow keys as well as by the pointer. An
        `hr` rather than a div with `role`, so the role is the element's own.
      */}
      <Box
        component="hr"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={ariaLabel}
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        onMouseDown={startResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            nudge(KEYBOARD_STEP_PX);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            nudge(-KEYBOARD_STEP_PX);
          }
        }}
        sx={{
          margin: 0,
          border: 'none',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: (theme) => theme.spacing(0.75),
          cursor: 'col-resize',
          zIndex: 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      />
      {children}
    </Drawer>
  );
}
