/**
 * ProfileSummarization — summarization settings form.
 */
import { memo, useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';

import { AccordionConstants } from '@/shared/lib/constants';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { useFormikContext } from 'formik';

import type { ProfileFormValues } from './profileUtils';
import ContextStrategySummarization from './contextBudget/ContextStrategySummarization';
import { handleConvertToNumberChange } from './contextBudget/validation';

export interface ProfileSummarizationProps {
  modelList: Array<{
    name: string;
    project_id: string;
    default?: boolean;
    display_name?: string;
  }>;
}

export const ProfileSummarization = memo(({ modelList: _modelList }: ProfileSummarizationProps) => {
  const { values, errors, setFieldValue } = useFormikContext<ProfileFormValues>();

  // The modelList prop is available for future model selection in summarization.

  const contextFormData = useMemo(
    () => ({
      enabled: values.context_enabled,
      max_context_tokens: values.max_context_tokens,
      preserve_recent_messages: values.preserve_recent_messages,
      enable_summarization: values.enable_summarization,
      summary_llm_settings: values.summary_llm_settings,
    }),
    [values],
  );

  const contextErrors = useMemo(
    () => ({
      ...(errors.summary_llm_settings && {
        summary_llm_settings: errors.summary_llm_settings as Record<string, string>,
      }),
    }),
    [errors],
  );

  const handleInputChange = useCallback(
    (
      _event: React.ChangeEvent<HTMLInputElement> | React.SyntheticEvent,
      field: string,
    ) => {
      const target = _event.target as HTMLInputElement;
      if (target.type === 'checkbox') {
        setFieldValue(field, (target as HTMLInputElement).checked);
        return;
      }
      handleConvertToNumberChange((target as HTMLInputElement).value, field, setFieldValue);
    },
    [setFieldValue],
  );

  const handleSummaryLLMInputChange = useCallback(
    (
      event: React.ChangeEvent<HTMLInputElement>,
      field: string,
      isNumeric?: boolean,
    ) => {
      if (isNumeric) {
        handleConvertToNumberChange(event.target.value, `summary_llm_settings.${field}`, setFieldValue);
        return;
      }
      setFieldValue(`summary_llm_settings.${field}`, event.target.value);
    },
    [setFieldValue],
  );

  return (
    <BasicAccordion
      showMode={AccordionConstants.AccordionShowMode.LeftMode}
      defaultExpanded
      slotSx={{ accordion: { background: 'transparent !important' } }}
      items={[
        {
          title: 'Default Summarization',
          content: (
            <Box sx={styles.accordionContent}>
              <ContextStrategySummarization
                formData={contextFormData}
                errors={contextErrors}
                handleInputChange={handleInputChange}
                handleSummaryLLMInputChange={handleSummaryLLMInputChange}
                isEnabled={values.context_enabled}
              />
            </Box>
          ),
        },
      ]}
    />
  );
});

ProfileSummarization.displayName = 'ProfileSummarization';

const styles = {
  accordionContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    paddingRight: '1rem',
    paddingTop: '0.6rem',
  },
};
