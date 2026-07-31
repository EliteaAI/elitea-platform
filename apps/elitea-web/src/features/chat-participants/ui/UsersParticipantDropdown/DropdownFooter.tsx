/**
 * DropdownFooter — footer for user participant dropdown.
 *
 * Ported from `[fsd]/features/chat/participants/ui/UsersParticipantDropdown/DropdownFooter.jsx`.
 */
import { memo } from 'react';

import { Box, Typography } from '@mui/material';

import { t } from '@/shared/ui/lib/t';

/**
 * DropdownFooter component — renders the footer of the user participant dropdown.
 */
const DropdownFooter = memo((): React.ReactElement => {
  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 1 }}>
      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center' }}>
        {t('chat-participants.dropdown.footer', 'Select a user to add to the chat')}
      </Typography>
    </Box>
  );
});

DropdownFooter.displayName = 'DropdownFooter';

export default DropdownFooter;
