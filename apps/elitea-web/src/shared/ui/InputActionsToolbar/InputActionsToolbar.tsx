import type { ReactNode } from 'react';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import SvgIcon from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';

import { CollapseIcon } from '../icons/collapse-icon';
import { ExpandIcon } from '../icons/expand-icon';
import { FullScreenIcon } from '../icons/full-screen-icon';
import { combineSx } from '../lib/combineSx';
import { t } from '../lib/t';

/**
 * @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass).
 *
 * Every optional property below is typed `| undefined` explicitly (not just
 * `?:`), matching MUI's own generated prop types (e.g. `TextFieldProps.minRows`)
 * — under `exactOptionalPropertyTypes`, a plain `foo?: string` forbids an
 * explicit `foo={possiblyUndefinedExpr}`, which is exactly how `InputBase`
 * wires this toolbar up (its own optional props flow straight through).
 */
export interface InputActionsToolbarProps {
  /** Gates the copy action's disabled state — nothing to copy when empty. */
  value?: string | undefined;
  showCopyAction?: boolean | undefined;
  showExpandAction?: boolean | undefined;
  showFullScreenAction?: boolean | undefined;
  /** Selects the expand/collapse icon and its tooltip copy. */
  isExpanded?: boolean | undefined;
  onCopy?: (() => void) | undefined;
  onToggleExpand?: (() => void) | undefined;
  onFullScreen?: (() => void) | undefined;
  sx?: SxProps<Theme> | undefined;
}

interface CopyActionProps {
  onCopy: (() => void) | undefined;
}

/** Split out of `InputActionsToolbar` (with `FullScreenAction`/`ExpandAction`) to keep that function's cyclomatic complexity under the §3.5 budget. */
function CopyAction({ onCopy }: CopyActionProps): ReactNode {
  const label = t('shared.ui.inputActionsToolbar.copy', 'Copy to clipboard');
  return (
    <Tooltip
      title={label}
      placement="top"
    >
      <IconButton
        color="tertiary"
        aria-label={label}
        onClick={onCopy}
      >
        <ContentCopyIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

interface FullScreenActionProps {
  onFullScreen: (() => void) | undefined;
}

function FullScreenAction({ onFullScreen }: FullScreenActionProps): ReactNode {
  const label = t('shared.ui.inputActionsToolbar.fullScreen', 'Full screen view');
  return (
    <Tooltip
      title={label}
      placement="top"
    >
      <IconButton
        color="tertiary"
        aria-label={label}
        onClick={onFullScreen}
      >
        <SvgIcon
          component={FullScreenIcon}
          inheritViewBox
          fontSize="small"
        />
      </IconButton>
    </Tooltip>
  );
}

interface ExpandActionProps {
  isExpanded: boolean;
  onToggleExpand: (() => void) | undefined;
}

function ExpandAction({ isExpanded, onToggleExpand }: ExpandActionProps): ReactNode {
  const label = isExpanded
    ? t('shared.ui.inputActionsToolbar.collapse', 'Collapse field')
    : t('shared.ui.inputActionsToolbar.expand', 'Expand field');
  const Icon = isExpanded ? CollapseIcon : ExpandIcon;
  return (
    <Tooltip
      title={label}
      placement="top"
    >
      <IconButton
        color="tertiary"
        aria-label={label}
        onClick={onToggleExpand}
      >
        <SvgIcon
          component={Icon}
          inheritViewBox
          fontSize="small"
        />
      </IconButton>
    </Tooltip>
  );
}

/**
 * The hover-revealed copy / expand-collapse / full-screen icon-button row
 * shown above a text field. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/input/InputActionsToolbar.jsx`.
 *
 * Deviation from the baseline: the baseline's buttons carried no
 * `aria-label` (icon-only, decorative-name-only via the `Tooltip`, which
 * axe's `button-name` rule does not accept as an accessible name — a
 * tooltip is not read by every assistive technology and is not associated
 * with the button via `aria-labelledby`/`aria-label`). Each button here gets
 * an explicit `aria-label` matching its tooltip copy.
 */
export function InputActionsToolbar({
  value,
  showCopyAction = true,
  showExpandAction = true,
  showFullScreenAction = true,
  isExpanded = false,
  onCopy,
  onToggleExpand,
  onFullScreen,
  sx,
}: InputActionsToolbarProps): ReactNode {
  const hasValue = Boolean(value);

  return (
    <Box
      sx={combineSx(
        (theme: Theme) => ({
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing(0.5),
        }),
        sx,
      )}
    >
      {showCopyAction && hasValue && <CopyAction onCopy={onCopy} />}
      {showFullScreenAction && <FullScreenAction onFullScreen={onFullScreen} />}
      {showExpandAction && hasValue && (
        <ExpandAction
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
        />
      )}
    </Box>
  );
}
