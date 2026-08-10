/**
 * Re-roles the ARIA bag `@dnd-kit`'s `useDraggable`/`useSortable` put on their
 * draggable node.
 *
 * dnd-kit defaults that bag to `role: 'button'` (plus `tabIndex: 0`,
 * `aria-disabled`, `aria-pressed`, `aria-roledescription: 'sortable'`,
 * `aria-describedby`). That is right for a dedicated drag HANDLE. Both call
 * sites here spread it onto the row CONTAINER instead — a container wrapping
 * the conversation/folder row's own buttons and menus — so every row claimed
 * to be a single button with focusable descendants inside it. axe reports that
 * as `nested-interactive`, impact "serious", once per row (15 nodes on a list
 * with a handful of folders), and it is a real barrier: assistive tech cannot
 * reliably reach the inner controls of a widget that says it is one button.
 *
 * The fix is a role swap, NOT a strip. `group` is not a widget role, so
 * focusable descendants are allowed and `nested-interactive` does not apply,
 * while `tabIndex`, `aria-roledescription` and `aria-describedby` all stay —
 * which means dnd-kit's KeyboardSensor keeps working exactly as before (it
 * activates from a keydown on the focused activator node; the node's `role`
 * was never what made that work). Keyboard reordering and the screen-reader
 * drag instructions both survive.
 *
 * `aria-pressed` is the one attribute dropped: it is a toggle-button state and
 * is not allowed on `role="group"` (axe `aria-allowed-attr`). dnd-kit only
 * ever sets it to `undefined` for a non-toggle draggable anyway.
 */

/** The keys this rewrites or removes from dnd-kit's `DraggableAttributes`. */
type DragAriaKeys = 'role' | 'aria-pressed';

export function asDragGroupAria<T extends Partial<Record<DragAriaKeys, unknown>>>(attributes: T): Omit<T, DragAriaKeys> & { readonly role: 'group' } {
  const { role: _role, 'aria-pressed': _pressed, ...rest } = attributes;
  return { ...rest, role: 'group' };
}
