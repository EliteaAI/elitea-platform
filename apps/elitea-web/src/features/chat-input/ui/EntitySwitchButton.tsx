import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { AgentEditorEntityIcon } from './AgentEditorEntityIcon';
import type { AgentEditorPanelStyles } from './AgentEditorPanel.styles';

/** The entity icon + name button (opens the entity-switch list) — factored out of `AgentEditorPanel.tsx` for the same §3.5 reason as its sibling sub-components. */
export function EntitySwitchButton({
  tooltip,
  onClick,
  iconUrl,
  isPipeline,
  isSmallView,
  participantName,
  styles,
}: {
  readonly tooltip: string;
  readonly onClick: (() => void) | undefined;
  readonly iconUrl: string | undefined;
  readonly isPipeline: boolean;
  readonly isSmallView: boolean;
  readonly participantName: string | undefined;
  readonly styles: AgentEditorPanelStyles;
}): ReactNode {
  return (
    <Tooltip
      placement="top"
      title={tooltip}
    >
      <Button
        variant="elitea"
        color="secondary"
        onClick={onClick}
      >
        <Box
          component="span"
          sx={styles.entityIconWrapper}
        >
          <AgentEditorEntityIcon
            iconUrl={iconUrl}
            isPipeline={isPipeline}
          />
        </Box>
        {!isSmallView && (
          <Typography
            variant="labelSmall"
            sx={styles.participantName}
          >
            {participantName}
          </Typography>
        )}
      </Button>
    </Tooltip>
  );
}
