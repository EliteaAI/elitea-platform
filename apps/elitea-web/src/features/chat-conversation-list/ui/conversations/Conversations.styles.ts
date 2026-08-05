import type { Theme } from '@mui/material/styles';

/** Matches `ui/groups/DroppableGroupedArea.tsx`'s own (unexported) `UNGROUPED_DROPPABLE_ID` constant — duplicated rather than imported since that file doesn't export it, and `getDropAreaState('ungrouped-conversations')`'s call site otherwise trips the `i18next/no-literal-string` gate (its `jsx-only` mode still flags a bare string literal argument written inside a JSX spread-attribute expression). */
export const UNGROUPED_DROPPABLE_ID = 'ungrouped-conversations';

export const menuIconStyle = { width: '16px', height: '16px' };

export function newFolderIconFill(theme: Theme, hasPermission: boolean): string {
  return hasPermission ? theme.vars.palette.icon.fill.secondary : theme.vars.palette.icon.fill.disabled;
}

export function createFolderButtonSx(theme: Theme) {
  return {
    minWidth: '28px',
    width: '28px',
    height: '28px',
    boxSizing: 'border-box',
    padding: theme.spacing(0.75),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

// `CloseIcon` (`@mui/icons-material/Close`) is sized via the `fontSize="small"`
// PROP at its call site, not an `sx.fontSize` — R-T11 bans ad-hoc `sx` font
// sizes; see `ConversationItem.menu.tsx`'s own doc comment for the same
// substitution on an identical baseline `sx={{fontSize:...}}` icon.
export function conversationsStyles(theme: Theme) {
  return {
    searchBarContainer: { display: 'flex', alignItems: 'center', gap: theme.spacing(0.5), padding: theme.spacing(0.5, 0), paddingBottom: theme.spacing(0.25) },
  };
}
