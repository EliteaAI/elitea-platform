import { memo, type ReactNode } from 'react';

import { Box } from '@mui/material';

interface LLMSettingsFormProps {
  children: ReactNode;
}

/**
 * Form-style container for LLM settings — wraps children in a Formik-like
 * controlled layout. This is a pass-through wrapper for use inside LLMSettings.
 */
export const LLMSettingsForm = memo(({ children }: LLMSettingsFormProps) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>
));

LLMSettingsForm.displayName = 'LLMSettingsForm';
