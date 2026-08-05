import type { ChangeEvent, KeyboardEvent, ReactNode, RefObject } from 'react';

import CancelIconMui from '@mui/icons-material/Cancel';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { ConversationNameWarningMessage } from '@/shared/lib/validation';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';
import { CheckedIcon } from '@/shared/ui/icons/checked-icon';

import type { ConversationItemStyles } from './ConversationItem.styles';

/**
 * The inline rename/create editor (`ConversationItem.jsx:469-505`), split
 * into its own presentational component for the same §3.5 `max-lines`/
 * `complexity`-budget reason `ConversationItem.row.tsx`'s own doc comment
 * explains for the non-editing row.
 */
export interface ConversationItemEditorProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly conversationName: string;
  readonly isConversationNameValid: boolean;
  readonly styles: ConversationItemStyles;
  readonly onChangeConversationName: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly onEnterKey: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConversationItemEditor(props: ConversationItemEditorProps): ReactNode {
  const { inputRef, conversationName, isConversationNameValid, styles, onChangeConversationName, onEnterKey, onConfirm, onCancel } = props;
  const theme = useTheme();

  // `StyledInputEnhancer`'s `onKeyDown` resolves to MUI `TextField`'s own
  // `KeyboardEventHandler<HTMLDivElement>` (the root `FormControl` element
  // `TextField` types its DOM event handlers against, not the inner
  // `<input>`) — only `event.key` is read below. Gates on
  // `isConversationNameValid` itself (the same guard the Confirm icon's
  // `onClick` uses below) so the caller's `onEnterKey` can just BE its own
  // confirm handler, unconditionally.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' && isConversationNameValid) onEnterKey();
  };

  return (
    <Box sx={styles.inputWrapper}>
      <StyledInputEnhancer
        inputRef={inputRef}
        autoComplete="off"
        value={conversationName}
        onChange={onChangeConversationName}
        onKeyDown={handleKeyDown}
        containerSx={{ display: 'flex', flex: 1 }}
      />
      <Tooltip
        title={isConversationNameValid ? '' : ConversationNameWarningMessage}
        placement="top"
      >
        <Box
          onClick={isConversationNameValid ? onConfirm : undefined}
          sx={styles.checkedIconWrapper}
          data-testid="conversation-confirm-edit"
        >
          <CheckedIcon fill={isConversationNameValid ? theme.vars.palette.icon.fill.default : theme.vars.palette.icon.fill.disabled} />
        </Box>
      </Tooltip>
      <Box
        onClick={onCancel}
        sx={styles.cancelIconWrapper}
        data-testid="conversation-cancel-edit"
      >
        <CancelIconMui
          fontSize="small"
          sx={{ color: theme.vars.palette.icon.fill.default }}
        />
      </Box>
    </Box>
  );
}
