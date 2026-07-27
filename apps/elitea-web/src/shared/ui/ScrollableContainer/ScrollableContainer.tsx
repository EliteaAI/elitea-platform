import type { ComponentRef, ReactNode, Ref } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import SimpleBar from 'simplebar-react';
import 'simplebar-react/dist/simplebar.min.css';

import { combineSx } from '../lib/combineSx';

const FILL_STYLE = { height: '100%', width: '100%' };
const FIT_CONTENT_STYLE = { height: 'auto', maxHeight: 'inherit', width: '100%' };

/**
 * The instance `simplebar-react`'s `SimpleBar` forwards its `ref` as.
 * Derived from the component itself (`ComponentRef`, React 19's
 * `ElementRef` replacement) rather than importing the type from
 * `simplebar-core` directly — that package is only a transitive dependency
 * here (`simplebar-react`'s peer, not this app's own `package.json`), and
 * `ComponentRef` needs no direct dependency on it at all.
 *
 * @public Exported so consumers typing a `ref` for this component (e.g. in
 * a test) can reuse it instead of re-deriving it themselves.
 */
export type SimpleBarInstance = ComponentRef<typeof SimpleBar>;

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface ScrollableContainerProps {
  children?: ReactNode;
  /** Fills the outer container's height (default `true`). `false` sizes to content instead — pair with a `maxHeight` in `sx` when scrolling should only activate past a limit. */
  fillContainer?: boolean;
  sx?: SxProps<Theme>;
  /** Forwarded to the underlying `SimpleBar` instance (e.g. `ref.current.getScrollElement()`). */
  ref?: Ref<SimpleBarInstance | null>;
}

/**
 * A scrollable container backed by SimpleBar. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/scrollable-container/ScrollableContainer.jsx`.
 *
 * `shared/brand/mui-overrides/MuiCssBaseline.ts` hides the browser's native
 * scrollbar chrome tree-wide ("every scroll surface that needs a visible
 * thumb uses `ScrollableContainer`'s SimpleBar instead" — that file's own
 * doc comment) — this is the one sanctioned place a visible custom
 * scrollbar comes from; a spec-level fallback to native `scrollbar-*` CSS
 * was pre-approved if `simplebar-react` proved unusable under React 19, but
 * it did not: `simplebar-react@3.3.2` is already a listed dependency (see
 * `package.json`) with no React-peer conflict, and this component's own
 * Storybook/vitest smoke coverage renders and scrolls it cleanly — so the
 * fallback was not taken.
 *
 * `ref` (React 19: a plain prop, no `forwardRef` needed) forwards to the
 * underlying `SimpleBar` instance so consumers can call its imperative API
 * (e.g. `ref.current.getScrollElement()`).
 *
 * Colour tokens (`palette.scrollbar.thumb`/`thumbHover`) come from
 * `theme.vars.palette.*` (R-T7); geometry is local `sx` targeting
 * SimpleBar's own DOM classes, which is why this file is exempt from R-T6
 * (that rule only bans `.Mui*-*`/`.css-*` internal selectors — SimpleBar's
 * `.simplebar-*` classes are its own public styling contract, not MUI's).
 */
export function ScrollableContainer({ children, fillContainer = true, sx, ref }: ScrollableContainerProps): ReactNode {
  return (
    <Box sx={combineSx(wrapperSx, sx)}>
      <SimpleBar
        ref={ref}
        autoHide={false}
        style={fillContainer ? FILL_STYLE : FIT_CONTENT_STYLE}
      >
        {children}
      </SimpleBar>
    </Box>
  );
}

const wrapperSx = (theme: Theme) => ({
  flex: 1,
  minHeight: 0,
  height: '100%',
  width: '100%',
  '& .simplebar-scrollbar::before': {
    borderRadius: theme.vars.shape.radiusPill,
    backgroundColor: theme.vars.palette.scrollbar.thumb,
    opacity: 1,
    transition: 'background-color 0.2s ease-in-out, opacity 0.2s ease-in-out',
  },
  '& .simplebar-scrollbar.simplebar-visible::before': {
    opacity: 1,
  },
  '& .simplebar-track': {
    pointerEvents: 'auto' as const,
  },
  '& .simplebar-track:hover .simplebar-scrollbar::before': {
    backgroundColor: theme.vars.palette.scrollbar.thumbHover,
    cursor: 'grabbing',
    opacity: 1,
  },
  '& .simplebar-dragging .simplebar-scrollbar::before': {
    backgroundColor: theme.vars.palette.scrollbar.thumbHover,
    opacity: 1,
  },
  '& .simplebar-track.simplebar-vertical': {
    width: '0.5rem',
    right: '0.08125rem',
  },
});
