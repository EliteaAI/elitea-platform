/**
 * ProfileContextManagement — context management settings form.
 */
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';

import { AccordionConstants } from '@/shared/lib/constants';
import { BaseSwitch } from '@/shared/ui/BaseSwitch';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { InfoLabelWithTooltip } from '@/shared/ui/InfoLabelWithTooltip';
import { InputBase } from '@/shared/ui/InputBase';
import { useFormikContext } from 'formik';

import type { ProfileFormValues } from './profileUtils';
import { handleConvertToNumberChange } from './contextBudget/validation';
import { ProfileLongTermMemory } from './ProfileLongTermMemory';
import { ProfileSummarization } from './ProfileSummarization';

export interface ProfileContextManagementProps {
  modelList: Array<{
    name: string;
    project_id: string;
    default?: boolean;
    display_name?: string;
  }>;
  onAutoSaveRequested?: () => void;
}

export function ProfileContextManagement({
  modelList,
  onAutoSaveRequested,
}: ProfileContextManagementProps) {
  const { values, errors, setFieldValue } = useFormikContext<ProfileFormValues>();

  const handleContextEnabledChange = useCallback(
    (_event: React.ChangeEvent<HTMLInputElement>, checkedValue: boolean) => {
      void setFieldValue('context_enabled', checkedValue);
      onAutoSaveRequested?.();
    },
    [setFieldValue, onAutoSaveRequested],
  );

  const handleNumericInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, fieldName: keyof Pick<ProfileFormValues, 'max_context_tokens' | 'preserve_recent_messages'>) => {
      const setValue = (f: string, v: unknown) => void setFieldValue(f, v);
      handleConvertToNumberChange(e.target.value, fieldName, setValue);
    },
    [setFieldValue],
  );

  const isEnabled = values.context_enabled;

  return (
    <BasicAccordion
      data-testid="context-management-section"
      showMode={AccordionConstants.AccordionShowMode.LeftMode}
      defaultExpanded
      slotSx={{
        accordion: { background: 'transparent' },
        details: { paddingTop: '0rem' },
      }}
      items={[
        {
          title: 'Default Context Management',
          content: (
            <Box sx={styles.accordionContent}>
              <Box sx={styles.toggleSection}>
                <FormControlLabel
                  control={
                    <BaseSwitch
                      data-testid="context-management-toggle"
                      checked={values.context_enabled}
                      onChange={handleContextEnabledChange}
                      slotProps={{
                        input: {
                          'aria-label': 'Enable context management',
                        },
                      }}
                    />
                  }
                  label="Enable context management for new conversations"
                  sx={styles.toggleLabel}
                />
              </Box>

              <Box sx={styles.fieldsRow}>
                <Box sx={styles.field}>
                  <InfoLabelWithTooltip
                    label="Max Context Tokens"
                    tooltip="Maximum number of tokens to keep in conversation context"
                  />
                  <InputBase
                    type="text"
                    inputMode="numeric"
                    value={values.max_context_tokens}
                    onChange={(e) =>
                      handleNumericInputChange(e as React.ChangeEvent<HTMLInputElement>, 'max_context_tokens')
                    }
                    error={!!errors.max_context_tokens}
                    helperText={errors.max_context_tokens || ' '}
                    disabled={!isEnabled}
                    slotProps={{
                      htmlInput: {
                        pattern: '[1-9][0-9]*',
                        'data-testid': 'max-context-tokens-input',
                      },
                    }}
                    containerSx={styles.formInput}
                  />
                </Box>

                <Box sx={styles.field}>
                  <InfoLabelWithTooltip
                    label="Preserve Recent Messages"
                    tooltip="Number of most recent messages to always keep in context"
                  />
                  <InputBase
                    type="text"
                    inputMode="numeric"
                    value={values.preserve_recent_messages}
                    onChange={(e) =>
                      handleNumericInputChange(e as React.ChangeEvent<HTMLInputElement>, 'preserve_recent_messages')
                    }
                    error={!!errors.preserve_recent_messages}
                    helperText={errors.preserve_recent_messages || ' '}
                    disabled={!isEnabled}
                    slotProps={{
                      htmlInput: {
                        pattern: '[1-9][0-9]*',
                      },
                    }}
                    containerSx={styles.formInput}
                  />
                </Box>
              </Box>

              <Box sx={styles.subSections}>
                <ProfileSummarization modelList={modelList} />
                <ProfileLongTermMemory />
              </Box>
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
  toggleSection: {
    display: 'flex',
    alignItems: 'center',
    paddingLeft: '0.5rem',
  },
  toggleLabel: {
    gap: '0.7rem',
  },
  fieldsRow: {
    display: 'flex',
    gap: '1.5rem',
  },
  subSections: {
    display: 'flex',
    flexDirection: 'column',
    paddingLeft: '1rem',
    borderLeft: '2px solid',
    borderColor: 'divider',
    marginTop: '0.5rem',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    flex: 1,
  },
  formInput: {
    padding: '0rem',
    margin: '0rem',
  },
};
