// @ts-nocheck — ported from JS; strict TS refinements pending
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { Box, Button, Modal, Typography } from '@mui/material';

import { VALIDATION_RULE, validateMaxTokens } from '@/widgets/llm-model-selector/lib/validation';
import { LLMSettings } from './LLMSettings';

interface LLMSettingsDialogProps {
  open: boolean;
  onApply: (settings: Record<string, unknown>) => void;
  onCancel: () => void;
  selectedModel?: { max_output_tokens?: number; supports_reasoning?: boolean } | null;
  llmSettings?: Record<string, unknown>;
  showWebhookSecret?: boolean;
  showStepsLimit?: boolean;
  onResetToDefaults?: () => void;
}

const paperStyle = {
  position: 'absolute' as const,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 480,
  maxWidth: '90vw',
  bgcolor: 'background.paper',
  borderRadius: '16px',
  border: '1px solid',
  borderColor: 'divider',
  boxShadow: '0px 0px 23.6px 0px #FFFFFF0D',
  p: 2,
} as const;

/**
 * Modal dialog for editing LLM model settings.
 * Ported from `[fsd]/widgets/llm-model-selector/ui/LLMSettingsDialog.jsx`.
 */
export const LLMSettingsDialog = memo(
  ({
    open,
    onApply,
    onCancel,
    selectedModel,
    llmSettings = {},
    showWebhookSecret = false,
    showStepsLimit = false,
    onResetToDefaults,
  }: LLMSettingsDialogProps) => {
    const [localSettings, setLocalSettings] = useState(llmSettings);

    const onChangeLLMSettings = useCallback(
      (field: string) => (value: unknown) => {
        setLocalSettings((prev) => ({ ...prev, [field]: value }));
      },
      [],
    );

    const handleOK = useCallback(() => onApply(localSettings), [localSettings, onApply]);

    const isDisabled = useMemo(() => {
      const result = validateMaxTokens(
        (localSettings?.max_tokens ?? -1) as number,
        selectedModel ?? undefined,
      );
      return result !== VALIDATION_RULE.VALID;
    }, [localSettings?.max_tokens, selectedModel]);

    useEffect(() => {
      if (open) setLocalSettings(llmSettings);
    }, [llmSettings, open]);

    return (
      <Modal open={open} onClose={onCancel}>
        <Box sx={paperStyle}>
          <Typography
            variant="h6"
            sx={{ mb: 2, fontWeight: 600 }}
          >
            Model settings
          </Typography>
          <LLMSettings
            llmSettings={localSettings}
            model={selectedModel}
            onChangeLLMSettings={onChangeLLMSettings}
            showWebhookSecret={showWebhookSecret}
            showStepsLimit={showStepsLimit}
          />
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            {onResetToDefaults && (
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => {
                  onResetToDefaults();
                  onCancel();
                }}
              >
                Reset to defaults
              </Button>
            )}
            <Button
              variant="outlined"
              color="secondary"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleOK}
              disabled={isDisabled}
            >
              Apply
            </Button>
          </Box>
        </Box>
      </Modal>
    );
  },
);

LLMSettingsDialog.displayName = 'LLMSettingsDialog';
