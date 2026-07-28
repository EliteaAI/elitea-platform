import type { ChangeEvent, ReactNode } from 'react';
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';

import type { AgentToolVariable } from '../lib/types';

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/Components/Tools/AgentVariables.jsx`
 * plus its one dependency, `apps/elitea-ui/src/components/VariableList.jsx`
 * (`VariableList` + its co-located `Variable` row), folded in as a private,
 * non-exported `VariableRow` below rather than a separate file.
 *
 * `VariableList.jsx` is NOT in this sub-unit's owned-file list and is not a
 * promoted `entities/` export — it is ALSO imported by
 * `apps/elitea-ui/src/components/VariableDialog.jsx`, which this sub-unit
 * does not own either. Per this batch's "port it yourself, locally, inside
 * your own owned files" directive for anything outside a promoted surface,
 * it is duplicated here, scoped to `AgentVariables`'s own needs only (kept
 * file-private, not re-exported) — whichever sub-unit ports
 * `VariableDialog.jsx` will duplicate its own copy rather than reach into
 * this one (`no-deep-slice-import-cross-slice`/intra-file privacy either
 * way, once `VariableDialog` lands in a different slice).
 *
 * `Variable`'s baseline field was `Input.StyledInputEnhancer` from the old
 * app's `shared/ui` barrel; the new app's equivalent,
 * `shared/ui/StyledInputEnhancer`, takes a standard MUI
 * `onChange={(event) => …}` handler (reading `event.target.value`) instead
 * of the baseline's `onInput`/`hasActionsToolBar`/`fieldName` prop trio —
 * ported behaviourally (fires on every keystroke, passes the field's
 * current text back to the caller), not prop-for-prop.
 */
export interface AgentVariablesProps {
  readonly variables: readonly AgentToolVariable[] | undefined;
  readonly onChangeVariable: (label: string, newValue: string) => void;
}

function VariableRow({ variable, onChangeVariable }: { readonly variable: AgentToolVariable; readonly onChangeVariable: (label: string, newValue: string) => void }): ReactNode {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChangeVariable(variable.name, event.target.value);
    },
    [onChangeVariable, variable.name],
  );

  return (
    <Box sx={variableRowSx}>
      <StyledInputEnhancer
        label={variable.name}
        value={variable.value}
        onChange={handleChange}
      />
    </Box>
  );
}

export function AgentVariables({ variables, onChangeVariable }: AgentVariablesProps): ReactNode {
  if (!variables?.length) {
    return null;
  }

  return (
    <Box
      data-testid="agent-variables"
      sx={containerSx}
    >
      <Box sx={variablesWrapperSx}>
        {variables.map((variable) => (
          <VariableRow
            key={variable.name}
            variable={variable}
            onChangeVariable={onChangeVariable}
          />
        ))}
      </Box>
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  padding: '0rem 0.5rem 0.5rem 0.5rem',
  // Top corners are deliberately left unset (CSS default 0) — this panel
  // sits directly below `ToolCard`'s squared-off-while-expanded header
  // (`ToolCard.styles.ts`'s `cardHeaderSx`), only the bottom corners round
  // to close off the card.
  borderBottomLeftRadius: theme.vars.shape.radiusMd,
  borderBottomRightRadius: theme.vars.shape.radiusMd,
  border: 'none',
  borderTop: `0.0625rem solid ${theme.vars.palette.border.lines}`,
});

const variablesWrapperSx: SxProps<Theme> = {
  padding: '0.75rem 1rem',
};

const variableRowSx: SxProps<Theme> = {
  marginBottom: '0.5rem',
};
