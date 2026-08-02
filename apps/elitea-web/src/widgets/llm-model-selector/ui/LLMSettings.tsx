// @ts-nocheck — ported from JS; strict TS refinements pending
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Box } from '@mui/material';

import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TOKENS_CUSTOM,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_STEPS_LIMIT,
  DEFAULT_TEMPERATURE,
} from '@/shared/lib/constants';
import { PROMPT_PAYLOAD_KEY } from '@/shared/lib/prompt-payload';
import { parseValueToIntNumber } from '@/shared/lib/number';
import { isNullOrUndefined } from '@/shared/lib/object';
import { VALIDATION_RULE, getMaxTokensHelperText, validateMaxTokens } from '@/widgets/llm-model-selector/lib/validation';
import { CapabilitySection } from './settings/CapabilitySection';
import { CreativitySlider } from './settings/CreativitySlider';
import { MaxTokensSection } from './settings/MaxTokensSection';
import { ReasoningSlider } from './settings/ReasoningSlider';
import { StepsLimitInput } from './settings/StepsLimitInput';
import { SecretField } from '@/shared/ui/SecretField';

interface LLMSettingsProps {
  llmSettings?: Record<string, unknown>;
  model?: Record<string, unknown>;
  onChangeLLMSettings: (field: string) => (value: unknown) => void;
  showWebhookSecret?: boolean;
  showStepsLimit?: boolean;
}

/**
 * LLM settings form panel.
 * Ported from `[fsd]/widgets/llm-model-selector/ui/LLMSettings.jsx`.
 */
export const LLMSettings = memo(
  ({
    llmSettings = {},
    model = {},
    onChangeLLMSettings,
    showWebhookSecret = false,
    showStepsLimit = false,
  }: LLMSettingsProps) => {
    const focusOnMaxTokens = useRef(false);

    const [maxTokens, setMaxTokens] = useState(
      (llmSettings?.max_tokens as number) === DEFAULT_MAX_TOKENS
        ? DEFAULT_MAX_TOKENS
        : ((llmSettings?.max_tokens as number) ?? DEFAULT_MAX_TOKENS_CUSTOM),
    );

    const onMaxTokensBlur = useCallback(() => {
      focusOnMaxTokens.current = false;
      setTimeout(() => {
        if (!focusOnMaxTokens.current && maxTokens !== DEFAULT_MAX_TOKENS && !maxTokens) {
          onChangeLLMSettings(PROMPT_PAYLOAD_KEY.maxTokens)(DEFAULT_MAX_TOKENS);
          setMaxTokens(DEFAULT_MAX_TOKENS);
        } else {
          if (maxTokens !== (llmSettings?.max_tokens as number)) {
            onChangeLLMSettings(PROMPT_PAYLOAD_KEY.maxTokens)(
              maxTokens === DEFAULT_MAX_TOKENS ? DEFAULT_MAX_TOKENS : parseInt(String(maxTokens), 10),
            );
          }
        }
      }, 50);
    }, [llmSettings?.max_tokens, maxTokens, onChangeLLMSettings]);

    const onMaxTokensFocus = useCallback(() => {
      focusOnMaxTokens.current = true;
    }, []);

    const onInputMaxTokens = useCallback(
      (value: number | string | Event) => {
        if (value === DEFAULT_MAX_TOKENS) {
          onChangeLLMSettings(PROMPT_PAYLOAD_KEY.maxTokens)(DEFAULT_MAX_TOKENS);
          setMaxTokens(DEFAULT_MAX_TOKENS);
          return;
        }
        if ((value as Event)?.preventDefault) (value as Event).preventDefault();
        const raw = (value as Event)?.target?.value ?? (value as number | string);
        const parsed = parseValueToIntNumber(String(raw));
        onChangeLLMSettings(PROMPT_PAYLOAD_KEY.maxTokens)(parsed);
        setMaxTokens(parsed as number);
      },
      [onChangeLLMSettings],
    );

    const onChangeWebhookSecret = useCallback(
      (_e: unknown, value: string) => {
        onChangeLLMSettings(PROMPT_PAYLOAD_KEY.webhookSecret)(value);
      },
      [onChangeLLMSettings],
    );

    useEffect(() => {
      if ((llmSettings?.max_tokens as number) !== maxTokens) {
        setMaxTokens(llmSettings?.max_tokens as number);
      }
    }, [llmSettings?.max_tokens, maxTokens]);

    const initializeDefaults = useCallback(() => {
      if (isNullOrUndefined(llmSettings?.temperature)) {
        onChangeLLMSettings(PROMPT_PAYLOAD_KEY.temperature)(DEFAULT_TEMPERATURE);
      }
      if ((llmSettings?.max_tokens as number | undefined) === undefined) {
        onChangeLLMSettings(PROMPT_PAYLOAD_KEY.maxTokens)(DEFAULT_MAX_TOKENS);
      }
      if ((model?.supports_reasoning as boolean | undefined) && isNullOrUndefined(llmSettings?.reasoning_effort)) {
        onChangeLLMSettings(PROMPT_PAYLOAD_KEY.reasoningEffort)(DEFAULT_REASONING_EFFORT);
      }
      if (showStepsLimit && isNullOrUndefined(llmSettings?.steps_limit)) {
        onChangeLLMSettings(PROMPT_PAYLOAD_KEY.stepsLimit)(DEFAULT_STEPS_LIMIT);
      }
    }, [llmSettings, model, showStepsLimit, onChangeLLMSettings]);

    useEffect(() => {
      initializeDefaults();
    }, [initializeDefaults]);

    const { maxTokensError, maxTokensHelperText } = useMemo(() => {
      const result = validateMaxTokens(maxTokens, model as Record<string, unknown>);
      return {
        maxTokensError: result !== VALIDATION_RULE.VALID,
        maxTokensHelperText: getMaxTokensHelperText(result, model as Record<string, unknown>),
      };
    }, [maxTokens, model]);

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, px: 4 }}>
        {'supports_reasoning' in (model as Record<string, unknown>) &&
        (model as Record<string, unknown>).supports_reasoning ? (
          <ReasoningSlider
            value={(llmSettings?.reasoning_effort as string) ?? DEFAULT_REASONING_EFFORT}
            onChange={onChangeLLMSettings(PROMPT_PAYLOAD_KEY.reasoningEffort)}
            disabled={false}
          />
        ) : (
          <CreativitySlider
            temperature={((llmSettings?.temperature as number) ?? DEFAULT_TEMPERATURE) as number}
            onChange={onChangeLLMSettings(PROMPT_PAYLOAD_KEY.temperature)}
          />
        )}
        <MaxTokensSection
          value={maxTokens}
          onChange={onInputMaxTokens}
          onBlur={onMaxTokensBlur}
          onFocus={onMaxTokensFocus}
          maxOutputTokens={model?.max_output_tokens as number | undefined}
          error={maxTokensError}
          helperText={maxTokensHelperText}
        />
        {showStepsLimit && (
          <StepsLimitInput
            value={(llmSettings?.steps_limit as number) ?? DEFAULT_STEPS_LIMIT}
            onChange={onChangeLLMSettings(PROMPT_PAYLOAD_KEY.stepsLimit)}
          />
        )}
        {showWebhookSecret && (
          <SecretField
            label="Webhook secret"
            value={(llmSettings?.webhook_secret as string) ?? null}
            onChange={onChangeWebhookSecret}
            passwordVisibilityToggle={false}
            required={false}
          />
        )}
        <CapabilitySection
          supportsVision={(model?.supports_vision as boolean) ?? false}
          supportsReasoning={(model?.supports_reasoning as boolean) ?? false}
        />
      </Box>
    );
  },
);

LLMSettings.displayName = 'LLMSettings';
