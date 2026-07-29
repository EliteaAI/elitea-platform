import type { ReactNode } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';

/**
 * The "close the agent/pipeline panel, fall back to the plain model
 * selector" close button — shared by `AgentEditorPanel.tsx`'s loading
 * (`AgentEditorPanelSkeleton.tsx`) and loaded renders (the baseline
 * repeats this exact JSX block in both of its own branches).
 */
export function SwitchToModelButton({
  disabled,
  onSwitchToModel,
}: {
  readonly disabled: boolean | undefined;
  readonly onSwitchToModel: (() => void) | undefined;
}): ReactNode {
  const label = t('chatInput.agentEditorPanel.switchToModel', 'Switch to model');
  return (
    <Tooltip
      placement="top"
      title={label}
    >
      <IconButton
        size="small"
        aria-label={label}
        onClick={onSwitchToModel}
        disabled={disabled}
        sx={closeButtonSx}
      >
        <CloseIcon sx={closeIconSx} />
      </IconButton>
    </Tooltip>
  );
}

const closeButtonSx: SxProps<Theme> = { padding: '0.375rem', flexShrink: 0 };
const closeIconSx: SxProps<Theme> = { width: '1rem', height: '1rem' };
