import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { FolderNameWarningMessage } from '@/shared/lib/validation';
import { CheckedIcon } from '@/shared/ui/icons/checked-icon';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';

/** @public Stable hook for E2E: the folder name field this editor owns. */
export const FOLDER_NAME_INPUT_TESTID = 'folder-name-input';

export interface FolderItemEditorProps {
  readonly folderName: string;
  readonly isFolderNameValid: boolean;
  readonly onChangeFolderName: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * `FolderItem.tsx`'s inline rename/create editor, split into its own file
 * purely to keep `FolderItem.tsx` under the §3.5 file-length (400 lines)
 * and per-function complexity (12) budgets — not one of the C2/folders
 * brief's own enumerated 6 components, same class of "extracted purely to
 * stay under budget" decomposition its own sibling files (`useDragAndDrop.
 * positioning.ts`, `ToolkitsListEmptyArea` inside `ToolkitsList.tsx`, …)
 * already establish throughout this codebase. `FolderItem.tsx` still owns
 * every callback this component's props wire to — this file is pure
 * presentation, no domain logic of its own.
 *
 * Baseline: `FolderItem.jsx:804-837`. `onCancel`/`onConfirm` are pre-resolved
 * by the caller (`isNewFolder ? handleOnCreateFolder|handleOnCancelCreateFolder
 * : handleOnSaveFolder|handleOnCloseEditFolder`) rather than an `isNew` flag
 * threaded down here — this component doesn't need to know WHICH action a
 * click performs, only that clicking confirms or cancels.
 *
 * `autoFocus` (baseline JSX prop) is replaced with an imperative `inputRef.
 * current?.focus()` on mount: `jsx-a11y/no-autofocus` (R-C1) bans the JSX
 * prop outright, with no baseline-toolchain equivalent — same fix
 * `ConversationItem.tsx`'s own `onKeyDown`-adjacent doc comment already
 * established for the identical situation (there, entering edit mode;
 * here, this component only ever MOUNTS while editing, so "on mount" and
 * "on entering edit mode" are the same event).
 *
 * The confirm/cancel buttons are real `IconButton`s, not the baseline's
 * non-interactive `Box onClick` — `jsx-a11y/click-events-have-key-events`/
 * `no-static-element-interactions` are hard lint errors in this repo (no
 * baseline equivalent); `shared/ui/CategoryItemCard`'s port already
 * established swapping a clickable `Box` for a real interactive element as
 * this codebase's fix for the identical defect class. The confirm button is
 * wrapped in a `<span>` (not a bare disabled `IconButton`) so the `Tooltip`
 * still receives pointer events while the button itself is disabled — MUI's
 * own documented workaround for "tooltip on a disabled control".
 *
 * `actions={{ enabled: false }}` on `StyledInputEnhancer` — required,
 * disclosed gap fix: `StyledInputEnhancer`'s own defaults
 * (`actions.enabled`/`forceShow` default `true`, `showFullScreen` hardcoded
 * `true` — see its own doc comment) are built for its "full-screen escape
 * hatch" use case, not this single-line, always-focused folder-name field.
 * Left un-overridden, they render a hover-independent Copy + full-screen-edit
 * toolbar absolutely positioned inside this row's `3.125rem` height, on top
 * of the real Confirm/Cancel `IconButton`s below — something the baseline
 * field (`FolderItem.jsx:298-309`, plain `Input.StyledInputEnhancer` with no
 * `hasActionsToolBar`) never had (old `InputBase.jsx`'s toolbar defaults
 * `hasActionsToolBar` to `false`). `enabled: false` short-circuits
 * `InputBase`'s `showToolbar = resolved.enabled && (...)` regardless of
 * `forceShow`/`showFullScreen`, restoring the baseline's zero-actions field.
 */
export function FolderItemEditor({ folderName, isFolderNameValid, onChangeFolderName, onKeyDown, onConfirm, onCancel }: FolderItemEditorProps): ReactNode {
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const confirmLabel = t('features.chatConversationList.folderItemEditor.confirm', 'Confirm');
  const cancelLabel = t('features.chatConversationList.folderItemEditor.cancel', 'Cancel');
  const nameLabel = t('features.chatConversationList.folderItemEditor.name', 'Folder name');

  return (
    <Box sx={editorContainerSx}>
      <StyledInputEnhancer
        autoComplete="off"
        inputRef={inputRef}
        fullWidth
        /*
         * `label=""` renders no visible label, which is the baseline's look
         * (`FolderItem.jsx:298-309` passes no label either) — but it also left
         * the field with NO accessible name at all: nothing for a screen
         * reader to announce, and nothing for `getByRole('textbox', {name})`
         * to match, so the only way to reach it was `querySelector('input')`.
         * The visual result is unchanged; the name now lives on the input
         * element itself via `aria-label`, which is exactly the case
         * `aria-label` exists for (a control whose purpose is clear visually
         * from context but has no visible text label).
         */
        label=""
        value={folderName}
        onChange={onChangeFolderName}
        onKeyDown={onKeyDown}
        containerSx={editorInputContainerSx}
        actions={{ enabled: false }}
        slotProps={{ htmlInput: { 'aria-label': nameLabel, 'data-testid': FOLDER_NAME_INPUT_TESTID } }}
      />
      <Tooltip
        title={isFolderNameValid ? '' : FolderNameWarningMessage}
        placement="top"
      >
        <span>
          <IconButton
            onClick={onConfirm}
            disabled={!isFolderNameValid}
            aria-label={confirmLabel}
            size="small"
            sx={checkButtonSx}
          >
            <CheckedIcon fill={isFolderNameValid ? theme.vars.palette.icon.fill.default : theme.vars.palette.icon.fill.disabled} />
          </IconButton>
        </span>
      </Tooltip>
      <IconButton
        onClick={onCancel}
        aria-label={cancelLabel}
        size="small"
        sx={cancelButtonSx}
      >
        <CloseIcon
          fontSize="small"
          sx={cancelIconSx}
        />
      </IconButton>
    </Box>
  );
}

const editorContainerSx: SxProps<Theme> = (theme: Theme) => ({
  width: '100%',
  height: '3.125rem',
  borderRadius: theme.vars.shape.radiusSm,
  padding: theme.spacing(1, 2),
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  background: theme.vars.palette.background.conversationEditor,
});

const editorInputContainerSx: SxProps<Theme> = { display: 'flex', flex: 1 };

// Both buttons: `IconButton` already renders as a circle (`shared/brand/
// mui-overrides/MuiIconButton.ts`) and already owns its own disabled/hover
// styling — the baseline's own `1rem`/`0.875rem` ad-hoc radii and manual
// `:hover` background are baseline-`Box`-onClick artefacts with no
// equivalent need once a real `IconButton` is doing that job. Only explicit
// sizing is kept, matching the baseline's `28px` (`1.75rem`) footprint.
const checkButtonSx: SxProps<Theme> = { width: '1.75rem', height: '1.75rem' };

const cancelButtonSx: SxProps<Theme> = { width: '1.75rem', height: '1.75rem' };

// `fontSize` set via the icon's own `fontSize="small"` PROP (a literal
// `'small'|'medium'|'large'|'inherit'` union MUI's `SvgIcon` exposes
// directly), not inside `sx` — `elitea/ad-hoc-font-size` (R-T11) bans a raw
// `fontSize` VALUE inside an `sx` object specifically; the JSX prop is a
// different AST shape the rule does not (and need not) inspect.
const cancelIconSx: SxProps<Theme> = (theme: Theme) => ({ color: theme.vars.palette.icon.fill.default });
