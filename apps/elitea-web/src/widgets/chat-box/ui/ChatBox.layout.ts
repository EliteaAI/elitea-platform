/**
 * `ChatBox`'s two layout modes, as `sx` objects.
 *
 * EMPTY — no turns and no conversation starters: the greeting and the
 * composer are centred together as one block in the middle of the chat
 * column, which is what production shows on a brand-new chat.
 *
 * ACTIVE — anything else: the transcript takes the free height and scrolls,
 * and the composer sits below it at the bottom of the column.
 *
 * Kept out of `ChatBox.tsx` because the component is already at its
 * `max-lines` and `complexity` ceilings; inline ternaries in the JSX pushed
 * it over both. Plain data, so they are also directly assertable in a test
 * without mounting the widget.
 */
import type { SxProps, Theme } from '@mui/material/styles';

/** The outer column that holds the transcript region and the composer. */
export function chatShellSx(isEmpty: boolean): SxProps<Theme> {
  return {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    ...(isEmpty && { justifyContent: 'center' }),
  };
}

/**
 * The transcript region. In the empty mode it must NOT claim the free height
 * (`flex: 1`), or the greeting is pushed to the top of the column and the
 * composer back down to the bottom — the very layout the empty mode exists
 * to replace.
 */
export function chatColumnSx(isEmpty: boolean): SxProps<Theme> {
  return isEmpty ? { flex: '0 0 auto', px: 2 } : { flex: 1, minHeight: 0, px: 2 };
}
