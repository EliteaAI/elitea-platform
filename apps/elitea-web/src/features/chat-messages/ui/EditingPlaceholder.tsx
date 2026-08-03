/**
 * Ported from `apps/elitea-ui/src/components/Chat/EditingPlaceholder.jsx` —
 * an icon + text box shown in place of a response, code block, table, or
 * diagram while it is being edited (by this user or a real-time
 * collaborator).
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { EditIcon } from '@/shared/ui/icons/edit-icon';

/** @public Props for `EditingPlaceholder`. */
export interface EditingPlaceholderProps {
  /** Text shown next to the edit icon. */
  readonly title?: string;
}

/**
 * `EditingPlaceholder` — renders an icon + text box in place of content
 * that is currently being edited elsewhere.
 */
export function EditingPlaceholder({
  title = 'Response editing...',
}: EditingPlaceholderProps): ReactNode {
  return (
    <Box data-testid="editing-placeholder" sx={containerSx}>
      <Box sx={innerBoxSx}>
        <Box sx={iconSx}>
          <EditIcon width={16} height={16} />
        </Box>
        <Typography variant="bodyMedium" color="text.secondary">
          {title}
        </Typography>
      </Box>
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme) => ({
  background: theme.vars.palette.background.aiAnswerBkg,
  width: '100%',
  borderRadius: theme.vars.shape.radiusMd,
  padding: '12px 16px',
  position: 'relative',
  boxSizing: 'border-box',
  minHeight: '48px',
  flex: 1,
});

const innerBoxSx: SxProps<Theme> = (theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  borderRadius: theme.vars.shape.radiusMd,
  border: `1px solid ${theme.vars.palette.border.chatEditPlaceholderBorder}`,
  padding: '8px 12px',
});

const iconSx: SxProps<Theme> = (theme) => ({
  display: 'flex',
  color: theme.vars.palette.border.chatEditPlaceholderBorder,
});
