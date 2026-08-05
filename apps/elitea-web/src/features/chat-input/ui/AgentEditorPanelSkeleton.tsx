import type { ReactNode, RefObject } from 'react';

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import type { SxProps, Theme } from '@mui/material/styles';

import type { AgentEditorPanelStyles } from './AgentEditorPanel.styles';
import { SwitchToModelButton } from './SwitchToModelButton';

/**
 * The "participant details not resolved yet" loading placeholder,
 * factored out of `AgentEditorPanel.tsx` for the same §3.5 complexity-
 * budget reason as `UserInput.tsx`'s own sub-components.
 */
export function AgentEditorPanelSkeleton({
  containerRef,
  disabled,
  onSwitchToModel,
  styles,
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly disabled: boolean | undefined;
  readonly onSwitchToModel: (() => void) | undefined;
  readonly styles: AgentEditorPanelStyles;
}): ReactNode {
  return (
    <Box
      ref={containerRef}
      sx={styles.outerContainer}
    >
      <Box sx={buttonGroupSx}>
        <Box sx={skeletonButtonSx}>
          <Skeleton
            animation="wave"
            variant="circular"
            width={16}
            height={16}
          />
          <Skeleton
            animation="wave"
            variant="rounded"
            width={64}
            height={12}
          />
        </Box>
        <Divider orientation="vertical" />
        <Box sx={skeletonButtonSx}>
          <Skeleton
            animation="wave"
            variant="rounded"
            width={40}
            height={12}
          />
        </Box>
        <Divider orientation="vertical" />
        <Box sx={skeletonButtonSx}>
          <Skeleton
            animation="wave"
            variant="rounded"
            width={52}
            height={12}
          />
        </Box>
        <Divider orientation="vertical" />
        <Box sx={skeletonButtonSx}>
          <Skeleton
            animation="wave"
            variant="circular"
            width={16}
            height={16}
          />
        </Box>
      </Box>

      <SwitchToModelButton
        disabled={disabled}
        onSwitchToModel={onSwitchToModel}
      />
    </Box>
  );
}

const buttonGroupSx: SxProps<Theme> = { display: 'flex', alignItems: 'center' };
const skeletonButtonSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.375rem 0.75rem' };
