import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';

import type { AgentVariable } from '../model/types';

/**
 * Ported from `apps/elitea-ui/src/components/ApplicationVariables.jsx`
 * (which composed its own sibling `components/VariableList.jsx`).
 *
 * `VariableList`/its inner `Variable` row are inlined here (private,
 * unexported `VariableRow` below) rather than referenced as a separate
 * owned file: `VariableList.jsx` is also consumed by two files OUTSIDE this
 * sub-unit's owned list (`components/VariableDialog.jsx`,
 * `pages/Applications/Components/Tools/AgentVariables.jsx`), so it is not a
 * private implementation detail of `ApplicationVariables` in the baseline —
 * it is a small (56-line), genuinely shared component with no confirmed
 * `shared/ui` home yet in this worktree. Rather than either (a) inventing a
 * `shared/ui/VariableList` this sub-unit was not asked to build, or (b)
 * leaving an unresolved cross-sub-unit import for something this small, its
 * ~15 lines of real behaviour (label = `name`, value, `onChangeVariable`
 * callback per row) are reproduced locally, scoped ONLY to what
 * `ApplicationVariables` itself needs — a future sub-unit that needs the
 * exact same row for `VariableDialog`/`AgentVariables` can promote a shared
 * version once it exists; this file does not claim to be that component's
 * canonical home.
 *
 * DISCLOSED REDESIGN — no ambient form context (see `../model/types.ts`'s
 * module doc comment): `variables` is a prop, `onChangeVariable` replaces
 * `formik.setFieldValue('version_details.variables', ...)`.
 */
export interface ApplicationVariablesProps {
  readonly variables: readonly AgentVariable[] | undefined;
  readonly onChangeVariable: (name: string, newValue: string) => void;
  readonly sx?: SxProps<Theme> | undefined;
}

interface VariableRowProps {
  readonly variable: AgentVariable;
  readonly onChangeVariable: (name: string, newValue: string) => void;
}

function VariableRow({ variable, onChangeVariable }: VariableRowProps): ReactNode {
  const handleInput = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChangeVariable(variable.name, event.target.value);
    },
    [variable.name, onChangeVariable],
  );

  return (
    <StyledInputEnhancer
      label={variable.name}
      value={variable.value}
      onChange={handleInput}
      expand={{ minRows: 1, maxRows: 15, collapsed: true }}
    />
  );
}

export function ApplicationVariables({ variables, onChangeVariable, sx }: ApplicationVariablesProps): ReactNode {
  const accordionItems = useMemo(
    () => [
      {
        title: 'Variables',
        content: (
          <Box sx={listSx}>
            {(variables ?? []).map((variable) => (
              <VariableRow
                key={variable.id ?? variable.name}
                variable={variable}
                onChangeVariable={onChangeVariable}
              />
            ))}
          </Box>
        ),
      },
    ],
    [variables, onChangeVariable],
  );

  if (!variables || variables.length === 0) return null;

  return (
    <BasicAccordion
      showMode="left"
      slotSx={{ accordion: accordionSx, ...(sx !== undefined ? { root: sx } : {}) }}
      items={accordionItems}
    />
  );
}

const accordionSx: SxProps<Theme> = (theme: Theme) => ({
  background: theme.vars.palette.background.tabPanel,
});

const listSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  marginTop: '0.5rem',
};
