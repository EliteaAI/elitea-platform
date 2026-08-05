import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseModal } from '@/shared/ui/BaseModal';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';

import type { AgentVariable } from './VariablesEditor.types';

/**
 * Local port of `apps/elitea-ui/src/components/VariableDialog.jsx` plus its
 * dependency `apps/elitea-ui/src/components/VariableList.jsx` (folded in
 * here as the private `VariableRow`, not a separate file) — `VariablesEditor
 * .tsx`'s one consumer, not exported from this slice's public barrel.
 *
 * No existing port anywhere reachable: `features/agents/ui/AgentVariables
 * .tsx` ported a DIFFERENT baseline file (`pages/Applications/Components/
 * Tools/AgentVariables.jsx`) for a different context, and its own doc
 * comment already discloses duplicating `VariableList` locally rather than
 * sharing it — anticipating this exact situation. This file follows that
 * same established precedent (its own local, unexported row renderer)
 * rather than reaching into `features/agents` (illegal — `no-sideways-
 * features` — and it would be the wrong baseline file anyway).
 *
 * `StyledInputEnhancer` (`shared/ui`) replaces the baseline's `Input
 * .StyledInputEnhancer` — same substitution `AgentVariables.tsx` already
 * made: a standard `onChange={(event) => …}` handler instead of the
 * baseline's `onInput`/`hasActionsToolBar`/`fieldName` prop trio.
 *
 * `BaseModal` (`variant="complex"`) replaces the baseline's bespoke
 * `StyledDialog`/`StyledDialogActions` pair — reusing this app's one shared
 * dialog shell rather than re-deriving one locally, per the same "reuse
 * shared/ui components rather than reinventing dialogs" convention
 * `StyledInputEnhancer` itself already follows for its own full-screen
 * editor. Disclosed sizing deviation: the baseline hard-coded a 60vw-wide
 * paper; `BaseModal` exposes only `variant`/`fullscreen` (no continuous
 * width knob), so `variant="complex"` (a fixed 37.5rem) is used as-is — a
 * minor, low-risk visual narrowing, not a functional gap.
 */
export interface VariableDialogProps {
  readonly open: boolean;
  readonly variables: readonly AgentVariable[];
  readonly onOK: (variables: readonly AgentVariable[]) => void;
  readonly onCancel: () => void;
}

function VariableRow({
  variable,
  onChangeVariable,
}: {
  readonly variable: AgentVariable;
  readonly onChangeVariable: (label: string, newValue: string) => void;
}): ReactNode {
  const label = variable.key ?? variable.name ?? '';
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChangeVariable(label, event.target.value),
    [label, onChangeVariable],
  );
  return (
    <Box sx={rowSx}>
      <StyledInputEnhancer
        label={label}
        value={variable.value}
        onChange={handleChange}
      />
    </Box>
  );
}

export function VariableDialog(props: VariableDialogProps): ReactNode {
  const { open, variables, onOK, onCancel } = props;
  const [localVariables, setLocalVariables] = useState<readonly AgentVariable[]>(variables);

  useEffect(() => setLocalVariables(variables), [variables]);

  const handleChangeVariable = useCallback((label: string, newValue: string) => {
    setLocalVariables((prev) => prev.map((item) => ((item.key ?? item.name) === label ? { ...item, value: newValue } : item)));
  }, []);

  const handleOK = useCallback(() => onOK(localVariables), [localVariables, onOK]);
  const handleCancel = useCallback(() => {
    setLocalVariables(variables);
    onCancel();
  }, [variables, onCancel]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleOK();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
      }
    },
    [handleOK, handleCancel],
  );

  return (
    <BaseModal
      open={open}
      onClose={handleCancel}
      onConfirm={handleOK}
      onKeyDown={handleKeyDown}
      title={
        <Typography variant="headingSmall">
          {t('chatInput.variableDialog.title', 'Variables ({{count}})', { count: variables.length })}
        </Typography>
      }
      actions={{
        cancelText: t('chatInput.variableDialog.cancel', 'Cancel'),
        confirmText: t('chatInput.variableDialog.apply', 'Apply'),
      }}
      content={
        <Box>
          {localVariables.map((variable) => (
            <VariableRow
              key={variable.key ?? variable.name}
              variable={variable}
              onChangeVariable={handleChangeVariable}
            />
          ))}
        </Box>
      }
    />
  );
}

const rowSx: SxProps<Theme> = { marginBottom: '0.5rem' };
