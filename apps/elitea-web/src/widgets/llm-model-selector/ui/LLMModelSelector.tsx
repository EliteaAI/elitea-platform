// @ts-nocheck — ported from JS with MUI sx callbacks; strict TS refinements pending
import { memo, useCallback, useRef, useState } from 'react';

import { Box, Button, ButtonGroup, Divider, Tooltip, Typography, useTheme } from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import PublicIcon from '@mui/icons-material/Public';
import SettingsIcon from '@mui/icons-material/Settings';

import type { LLMModelSelectorProps } from '@/widgets/llm-model-selector/lib/types';

import { LLMSettingsDialog } from './LLMSettingsDialog';
import LLMModelsMenu from './LLMModelsMenu';

/**
 * Reusable LLM Model Selector with model dropdown and optional settings.
 * Ported from `[fsd]/widgets/llm-model-selector/ui/LLMModelSelector.jsx`.
 */
const LLMModelSelector = memo(
  ({
    selectedModel,
    onSelectModel,
    models = [],
    disabled = false,
    onClickSettings,
    llmSettings = {},
    onSetLLMSettings,
    showWebhookSecret = false,
    showStepsLimit = false,
    showSettingsEntry = true,
    modelTooltip = 'Select LLM Model',
    settingsTooltip = 'Model Settings',
    onResetToDefaults,
    dataTourTargetId,
  }: LLMModelSelectorProps) => {
    const theme = useTheme();
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [showLLMSettings, setShowLLMSettings] = useState(false);
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

    const handleModelMenuClick = () => setAnchorEl(anchorRef.current);
    const handleClose = () => setAnchorEl(null);

    const handleSettingsClick = useCallback(() => {
      if (onClickSettings) {
        onClickSettings();
      } else if (onSetLLMSettings) {
        setShowLLMSettings(true);
      }
    }, [onClickSettings, onSetLLMSettings]);

    const handleApplySettings = useCallback(
      (newSettings: Record<string, unknown>) => {
        if (onSetLLMSettings) onSetLLMSettings(newSettings as LLMModelSelectorProps['llmSettings']);
        setShowLLMSettings(false);
      },
      [onSetLLMSettings],
    );

    const handleCancelSettings = useCallback(() => {
      setShowLLMSettings(false);
    }, []);

    return (
      <>
        <ButtonGroup
          variant="outlined"
          disableElevation
          disabled={disabled}
          ref={anchorRef}
          aria-label="Model Selector Menu"
          data-testid="model-selector-button"
          sx={styles.buttonGroup}
          data-tour={dataTourTargetId || undefined}
        >
          <Tooltip placement="top" title={modelTooltip}>
            <Box
              component="span"
              sx={styles.modelButtonWrapper}
            >
              <Button
                variant="outlined"
                disabled={disabled}
                onClick={handleModelMenuClick}
                sx={styles.modelButton}
                data-testid="model-selector-name"
              >
                {selectedModel && (
                  <Box
                    component="span"
                    sx={styles.iconWrapper}
                  >
                    {selectedModel.shared ? (
                      <PublicIcon fontSize="small" />
                    ) : (
                      <BusinessIcon fontSize="small" />
                    )}
                  </Box>
                )}
                <Box
                  component="span"
                  sx={styles.modelNameWrapper}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {selectedModel?.display_name || selectedModel?.name || 'None'}
                  </Typography>
                </Box>
              </Button>
            </Box>
          </Tooltip>
          {showSettingsEntry && (
            <>
              <Divider orientation="vertical" flexItem />
              <Tooltip placement="top" title={settingsTooltip}>
                <Box component="span">
                  <Button
                    size="small"
                    aria-expanded={showLLMSettings ? 'true' : undefined}
                    aria-label="model settings menu"
                    aria-haspopup="menu"
                    onClick={handleSettingsClick}
                    variant="outlined"
                    disabled={!onSetLLMSettings}
                  >
                    <SettingsIcon
                      fontSize="small"
                      sx={{
                        width: '1rem',
                        height: '1rem',
                        fill:
                          !onSetLLMSettings || disabled
                            ? theme.palette.text.disabled
                            : undefined,
                      }}
                    />
                  </Button>
                </Box>
              </Tooltip>
            </>
          )}
        </ButtonGroup>

        <LLMModelsMenu
          anchorEl={anchorEl}
          onClose={handleClose}
          models={models}
          selectedModel={selectedModel !== null ? selectedModel : undefined}
          onSelectModel={onSelectModel ?? (() => {})}
        />

        {onSetLLMSettings && (
          <LLMSettingsDialog
            open={showLLMSettings}
            onApply={handleApplySettings}
            onCancel={handleCancelSettings}
            selectedModel={selectedModel !== null ? selectedModel : undefined}
            llmSettings={llmSettings as Record<string, unknown>}
            showWebhookSecret={showWebhookSecret}
            showStepsLimit={showStepsLimit}
            onResetToDefaults={onResetToDefaults}
          />
        )}
      </>
    );
  },
);

LLMModelSelector.displayName = 'LLMModelSelector';

export default LLMModelSelector;

const styles = {
  buttonGroup: {
    maxWidth: '100%',
    minWidth: 0,
    flexShrink: 1,
  },
  modelButtonWrapper: {
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    display: 'inline-block',
  },
  modelButton: {
    minWidth: 0,
    maxWidth: '100%',
  },
  modelNameWrapper: {
    minWidth: 0,
    overflow: 'hidden',
    display: 'block',
  },
  iconWrapper: {
    width: '1rem',
    height: '1rem',
    minWidth: '1rem',
    minHeight: '1rem',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
} as const;
