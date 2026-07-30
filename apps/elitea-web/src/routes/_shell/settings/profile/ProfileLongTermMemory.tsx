/**
 * ProfileLongTermMemory — placeholder accordion.
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { AccordionConstants } from '@/shared/lib/constants';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';

export function ProfileLongTermMemory() {
  return (
    <BasicAccordion
      showMode={AccordionConstants.AccordionShowMode.LeftMode}
      slotSx={{
        accordion: {
          background: 'transparent !important',
          opacity: 0.5,
        },
      }}
      items={[
        {
          title: 'Long-term Memory',
          content: (
            <Box sx={styles.accordionContent}>
              <Typography variant="bodyMedium" color="text.primary">
                Coming soon — Manage what the AI remembers about you across conversations.
              </Typography>
            </Box>
          ),
        },
      ]}
    />
  );
}

const styles = {
  accordionContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    paddingRight: '1rem',
  },
};
