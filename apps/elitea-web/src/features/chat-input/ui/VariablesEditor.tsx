import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { VariablesIcon } from '@/shared/ui/icons/variables-icon';

import { VariableDialog } from './VariableDialog';
import type { AgentVariable } from './VariablesEditor.types';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-input/
 * VariablesEditor.jsx` (unit C3, "chat-input" cluster — composed inside
 * `AgentEditorPanel.tsx`). See `VariableDialog.tsx`'s own doc comment for
 * the dialog it opens (its baseline dependency, `components/
 * VariableDialog.jsx` + `components/VariableList.jsx`, ported locally
 * there — no existing port anywhere reachable).
 */
export interface VariablesEditorProps {
  readonly variables: readonly AgentVariable[];
  readonly onChange: (variables: readonly AgentVariable[]) => void;
  readonly isSmallView?: boolean | undefined;
}

const iconStyle = { width: '1rem', height: '1rem' };

export function VariablesEditor(props: VariablesEditorProps): ReactNode {
  const { variables, onChange, isSmallView } = props;
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const handleChangeVariables = useCallback(
    (newVariables: readonly AgentVariable[]) => {
      onChange(newVariables);
      handleClose();
    },
    [onChange, handleClose],
  );

  return (
    <>
      <Tooltip
        placement="top"
        title={t('chatInput.variablesEditor.tooltip', 'Set variables')}
      >
        <Button
          size="small"
          variant="elitea"
          color="secondary"
          aria-expanded={open ? 'true' : undefined}
          aria-label={t('chatInput.variablesEditor.menuLabel', 'variables selector menu')}
          aria-haspopup="menu"
          onClick={handleOpen}
        >
          {isSmallView ? <VariablesIcon style={iconStyle} /> : t('chatInput.variablesEditor.label', 'Variables')}
        </Button>
      </Tooltip>
      <VariableDialog
        variables={variables}
        open={open}
        onOK={handleChangeVariables}
        onCancel={handleClose}
      />
    </>
  );
}
