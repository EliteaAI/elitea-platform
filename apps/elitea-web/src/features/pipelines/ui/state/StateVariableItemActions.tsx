/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * state/StateVariableItemActions.jsx` (101 lines) — unit A2j. The trailing
 * action cluster of a state-variable row: either a toggle switch (the two
 * always-present `input`/`messages` rows) or the type selector + default
 * value + delete button trio (every other row).
 *
 * `DeleteIcon` (baseline: `@/components/Icons/DeleteIcon`, a custom SVG,
 * not part of S2's ported `shared/ui/icons/` set) -> `@mui/icons-material`'s
 * `DeleteOutlined`, the SAME already-established interim substitute
 * `ui/nodes/BaseNode/NodeCardHeader.tsx`/`ui/nodes/RunStateNode.tsx` already
 * document for this exact gap. `IconButton` `variant="elitea"` is dropped,
 * same reasoning as `./StateVariableIconButton.tsx`.
 */
import type { ChangeEvent, ReactNode } from 'react';

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { BaseSwitch } from '@/shared/ui/BaseSwitch';
import { t } from '@/shared/i18n';

import { StateTypeSelector } from './StateTypeSelector';
import { StateVariableDefaultValue } from './StateVariableDefaultValue';

/** @public */
export interface StateVariableItemActionsProps {
  readonly type: string;
  readonly enabled?: boolean | undefined;
  readonly showToggle?: boolean | undefined;
  readonly drawerWidth?: number | undefined;
  readonly disableTypeSelector?: boolean | undefined;
  readonly defaultValue?: unknown;
  readonly onTypeChange?: ((type: string) => void) | undefined;
  readonly onToggle?: ((checked: boolean) => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
  readonly onDefaultValueClick?: (() => void) | undefined;
  readonly onDefaultValueChange?: ((event: ChangeEvent<HTMLInputElement>) => void) | undefined;
  readonly editable?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}

export function StateVariableItemActions(props: StateVariableItemActionsProps): ReactNode {
  const {
    type,
    enabled,
    showToggle = false,
    drawerWidth = 300,
    disableTypeSelector = false,
    defaultValue = '',
    onTypeChange,
    onToggle,
    onDelete,
    onDefaultValueClick,
    onDefaultValueChange,
    editable = true,
    disabled,
  } = props;

  const handleToggle = (event: ChangeEvent<HTMLInputElement>): void => onToggle?.(event.target.checked);

  if (showToggle) {
    return (
      <Box sx={actionContainerSx}>
        <BaseSwitch
          checked={enabled}
          onChange={handleToggle}
          disabled={disabled}
        />
      </Box>
    );
  }

  const resolvedType =
    type === FlowEditorConstants.LegacyIntType ? FlowEditorConstants.StateVariableTypes.Number : type;

  return (
    <>
      <StateTypeSelector
        type={resolvedType}
        onTypeChange={onTypeChange ?? (() => {})}
        disabled={disableTypeSelector}
      />

      <StateVariableDefaultValue
        drawerWidth={drawerWidth}
        defaultValue={defaultValue}
        disabled={!editable}
        onIconClick={onDefaultValueClick}
        onChange={onDefaultValueChange}
        type={type}
      />
      <Box sx={actionContainerSx}>
        <IconButton
          aria-label={t('pipelines.flowEditor.state.deleteVariable', 'Delete')}
          onClick={onDelete}
          disabled={disabled}
          sx={deleteButtonSx}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Box>
    </>
  );
}

const actionContainerSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const deleteButtonSx: SxProps<Theme> = (theme: Theme) => ({
  padding: theme.spacing(0.25),
  alignSelf: 'center',
});
