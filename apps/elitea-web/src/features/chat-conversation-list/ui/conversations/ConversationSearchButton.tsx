import type { ReactNode } from 'react';
import { useCallback } from 'react';

// Icon substitution (disclosed): no `search-icon.tsx` exists in the S2 icon
// port (`ls src/shared/ui/icons/` — only `inventory-search-icon.tsx`/
// `web-search-icon.tsx`, neither a plain search glyph). `@mui/icons-material`'s
// `Search` is the standard magnifying-glass glyph, single-default-import per
// `shared/ui/ControlsDropdown.tsx`'s own established substitution convention
// for a missing S2 icon.
import SearchIcon from '@mui/icons-material/Search';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';

/**
 * Ported from `apps/elitea-ui/src/components/ConversationSearchButton.jsx`.
 *
 * Disclosed substitutions, all established elsewhere in this codebase
 * already (not re-derived here):
 *  - `IconButton` has no typed `variant` prop (`shared/brand/mui-overrides/
 *    MuiIconButton.ts`'s own doc comment — its one skin keys entirely off
 *    `color`), so the baseline's `variant="elitea" color="secondary"` drops
 *    the `variant`, same substitution `shared/ui/AddButton`'s doc comment
 *    already made for the identical baseline pattern.
 *  - The baseline's `Tooltip` came from `@/ComponentsLib/Tooltip`; every
 *    other ported component in this codebase uses plain MUI `Tooltip`
 *    directly (e.g. `features/pipelines/ui/AddNodeMenu.tsx`), so this does
 *    too — no bespoke wrapper exists in `shared/ui`.
 *  - A11y fix, not in the baseline: an icon-only `IconButton` wrapped in a
 *    `Tooltip` has no accessible name until the tooltip is shown (axe's
 *    `button-name` rule) — `aria-label` reuses the same copy, same pattern
 *    `shared/ui/AddButton`'s own doc comment already established.
 */
export interface ConversationSearchButtonProps {
  readonly collapsed?: boolean;
  readonly onExpand?: () => void;
  readonly onSearchActivate?: (active: boolean) => void;
}

export function ConversationSearchButton({ collapsed = false, onExpand, onSearchActivate }: ConversationSearchButtonProps): ReactNode {
  const label = t('features.chatConversationList.conversationSearchButton.tooltip', 'Search chats');

  const handleSearchClick = useCallback(() => {
    if (collapsed) onExpand?.();
    onSearchActivate?.(true);
  }, [collapsed, onExpand, onSearchActivate]);

  return (
    <Tooltip
      title={label}
      placement="top"
    >
      <IconButton
        onClick={handleSearchClick}
        color="secondary"
        aria-label={label}
        data-testid="conversation-search-button"
        sx={(theme) => ({
          // `!important` dropped (R-T5: `elitea/no-important-sx` bans it
          // outright) — an `sx`-generated class already outranks
          // `IconButton`'s base rule at equal specificity, same reasoning
          // `features/pipelines/ui/AddNodeMenu.tsx`'s own doc comment
          // already established for the identical baseline pattern.
          minWidth: '28px',
          width: '28px',
          height: '28px',
          boxSizing: 'border-box',
          padding: theme.spacing(0.75),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 0,
        })}
      >
        <SearchIcon sx={{ width: '16px', height: '16px', color: (theme) => theme.vars.palette.icon.fill.secondary }} />
      </IconButton>
    </Tooltip>
  );
}
