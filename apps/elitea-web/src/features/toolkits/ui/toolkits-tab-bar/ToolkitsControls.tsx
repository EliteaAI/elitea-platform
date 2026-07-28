import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { ViewMode } from '@/shared/lib/enums';
import { ControlsDropdown } from '@/shared/ui/ControlsDropdown';
import type { ControlsDropdownItem } from '@/shared/ui/ControlsDropdown';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/toolkits-tab-bar/
 * ToolkitsControls.jsx` (Wave-2 unit A4e) — the kebab-menu + (public-view-
 * only) authors row shown next to a toolkit's tab bar.
 *
 * MAJOR DISCLOSED REDESIGN: the baseline assembles its menu items from SIX
 * separate cross-cutting concerns — `usePin`/`usePinMenu`
 * (`widgets/pin-toggler`), `useCopyLinkMenu`
 * (`components/CopyLinkToEntityButton`), `useForkEntityMenu`
 * (`components/Fork/ForkEntityButton`), `useDeleteToolkitMenu`/
 * `useExportToolkitMenu` (`pages/Toolkits/{Delete,Export}ToolkitButton`) —
 * plus `AuthorsButton` (`pages/Applications/Components/Applications/
 * AuthorsButton`, itself a thin wrapper over `pages/Common/Components/
 * AuthorsButton`). None of the six is this sub-unit's owned scope, and none
 * of the `ControlsDropdownItem`-shaped MENU hooks the baseline actually
 * calls (`useDeleteToolkitMenu`/`useExportToolkitMenu`/`useForkEntityMenu`/
 * `useCopyLinkMenu`/`usePinMenu`) exist anywhere in this app as of this
 * sub-unit's own build (checked: `features/toolkits/ui/{Delete,Export}
 * ToolkitButton.tsx` exist as sibling sub-units' STANDALONE icon+confirm-
 * modal buttons, a different shape than a menu-item-producing hook — no
 * `use*Menu` hook is exported by either). `widgets/pin-toggler` also has no
 * port anywhere. Two of the baseline's six (`DeleteToolkitButton`/
 * `ExportToolkitButton`'s real page-level menu wiring, and `AuthorsButton`'s
 * real implementation) additionally live under `pages/` in the baseline —
 * even with a menu-hook port, `features/toolkits` could never import a
 * `pages/`-owned one directly (`no-upward-from-features`, spec §3.2:
 * `features/` sits BELOW `pages/`), so faithfully reproducing this exact
 * composition inside `features/toolkits` is architecturally impossible at
 * this layer regardless of build order.
 *
 * This component keeps the REAL structural behaviour — a kebab dropdown of
 * caller-supplied `ControlsDropdownItem`s, plus a `viewMode === Public`-
 * gated authors slot — and takes both as props, same "caller assembles
 * cross-cutting menu items/slots, this component owns only the dropdown
 * shell + the Public-view gate" convention `entities/application-form`'s
 * slot components already established. A future `pages/toolkits` (or a
 * `widgets/`-layer composition) is the correct place to build the six real
 * menu-item hooks/slots (which MAY compose the sibling `DeleteToolkitButton`/
 * `ExportToolkitButton` components' own confirm-flow logic, once such a
 * caller exists) and pass the results in here.
 */
export interface ToolkitsControlsProps {
  readonly viewMode: string;
  readonly menuItems: readonly ControlsDropdownItem[];
  /** Rendered only when `viewMode === 'public'` — the caller's own `AuthorsButton`-equivalent. */
  readonly authorsSlot?: ReactNode;
}

export function ToolkitsControls({ viewMode, menuItems, authorsSlot }: ToolkitsControlsProps): ReactNode {
  return (
    <Box sx={containerSx}>
      {viewMode === ViewMode.Public && <Box sx={authorsSlotSx}>{authorsSlot}</Box>}
      <ControlsDropdown items={[...menuItems]} />
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  position: 'relative',
  alignItems: 'center',
  paddingLeft: theme.spacing(1),
  '&::before': {
    content: '""',
    position: 'absolute',
    left: 0,
    top: '0.25rem',
    bottom: '0.25rem',
    borderLeft: `1px solid ${theme.vars.palette.border.lines}`,
  },
});

const authorsSlotSx: SxProps<Theme> = (theme: Theme) => ({ marginRight: theme.spacing(1) });
