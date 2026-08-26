/**
 * DropdownFooter — footer for user participant dropdown.
 *
 * Ported from `[fsd]/features/chat/participants/ui/UsersParticipantDropdown/DropdownFooter.jsx`.
 *
 * Baseline behaviour (`DropdownFooter.jsx:7-74`): a clickable "All users"
 * row, gated on `usersCount > 1` (a single-member chat has no "everyone
 * else" to bulk-add), that fires through the SAME selection handler wired to
 * individual user rows (`index.jsx`'s `onSelectUser={onSelectParticipant}`)
 * — i.e. selecting the footer performs a bulk add-all action, not decoration.
 */
import { memo } from 'react';

import { Box, MenuItem, MenuList, Typography } from '@mui/material';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';

import { t } from '@/shared/i18n';

/**
 * Sentinel passed to `onSelectAll` in place of a real user row — mirrors the
 * baseline's own sentinel (`DropdownFooter.jsx:24-29`'s
 * `onClick?.(event, 'All users')`, routed through the individual-selection
 * handler) so a future caller can special-case it the same way `widgets/
 * chat-box/ui/hooks/useChatBoxActions.ts`'s own `'@everyone'` sentinel is
 * special-cased for the unrelated @-mention "everyone" concept.
 */
export const ALL_USERS_SENTINEL_ID = 'All users';

export interface DropdownFooterProps {
  /** Total selectable user count — the "All users" action is hidden at `<= 1` (baseline: `DropdownFooter.jsx:31`). */
  usersCount: number;
  /** Fires the same bulk-add-all action the baseline routed through `onSelectOption('All users')`. */
  onSelectAll: () => void;
}

/**
 * DropdownFooter component — renders the "All users" bulk-add quick action.
 */
const DropdownFooter = memo((props: DropdownFooterProps): React.ReactElement | null => {
  const { usersCount, onSelectAll } = props;

  if (usersCount <= 1) return null;

  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 1 }}>
      {/*
        * `MenuList` wrapper: MUI 9.2's `MenuItem` reads `MenuListContext`
        * unconditionally and THROWS ("MUI: MenuListContext is missing…")
        * when it is absent. This footer renders under the dropdown's bare
        * `Popper`/`Paper` (`index.tsx`), not under a `Menu`, so without a
        * provider the row crashed the surrounding tree the moment the
        * dropdown opened.
        */}
      {/*
        * Labelled: this `MenuList` holds ONLY the bulk action, while the user
        * rows above it (`UserMenu`) are role-less `div`s. Unlabelled, the one
        * ARIA-meaningful container in the popup would announce as "menu,
        * 1 item" and read as if there were no participants to choose.
        */}
      <MenuList
        disablePadding
        aria-label={t('chat-participants.dropdown.quickActionsLabel', 'Participant quick actions')}
        sx={{ outline: 'none' }}
      >
        <MenuItem
          onClick={onSelectAll}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            borderRadius: 'var(--el-shape-radiusSm, 4px)',
          }}
        >
          <GroupOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="bodyMedium" color="text.secondary">
            {t('chat-participants.dropdown.allUsers', 'All users')}
          </Typography>
        </MenuItem>
      </MenuList>
    </Box>
  );
});

DropdownFooter.displayName = 'DropdownFooter';

export default DropdownFooter;
