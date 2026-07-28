import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { HeadingChip } from '@/shared/ui/HeadingChip';
import { SingleSelect, type SingleSelectOption } from '@/shared/ui/SingleSelect';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';
import { capitalizeFirstChar } from '@/shared/lib/string';

import { AIAssistantInput } from '../AIAssistantInput';
import type { AiAssistantLlmSettings } from '../../api/aiAssistantPredict';
import { FStringAutocompletePopper } from '../FStringAutocompletePopper';
import { useFStringInputAutocomplete } from '../../model/useFStringInputAutocomplete';
import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { useInputOptions } from '../../lib/flow-editor/hooks/useInputOptions';

/** Minimal shape both `AIAssistantInput`'s `fieldBinding.onInput` and a plain `<input>` change event satisfy. */
interface SimpleLLMInputChangeEvent {
  readonly preventDefault: () => void;
  readonly target: { readonly value: string };
}

export interface SimpleLLMInputMappingValue {
  readonly type?: string;
  readonly value: unknown;
}

interface NodeFieldInputProps {
  readonly shouldEnableAIAssistant: boolean;
  readonly variable: string;
  readonly value: string;
  readonly disabled?: boolean | undefined;
  readonly onInput: (event: SimpleLLMInputChangeEvent) => void;
  readonly variableName: string;
  readonly enableFStringAutocomplete: boolean;
  readonly stateVariableOptions: readonly SingleSelectOption[];
  readonly modelConfig?: AiAssistantLlmSettings | null;
}

/**
 * `apps/elitea-ui/…/settings/SimpleLLMInputItem.jsx:14-108`'s co-located
 * `NodeFieldInput`. Renders either `AIAssistantInput` (already ported,
 * unit A2a) or `shared/ui/StyledInputEnhancer` (unit S1-F), matching the
 * baseline's `shouldEnableAIAssistant` branch.
 *
 * **DISCLOSED REDESIGN, forced by the already-landed `AIAssistantInput`'s
 * real prop surface** (`../AIAssistantInput.tsx`, read directly): the
 * baseline spreads ~20 flat props (`onBlur`/`onClick`/`onFocus`/`onKeyDown`/
 * `onKeyUp`/`containerProps`/`inputRef`/`language`/...) onto BOTH branches,
 * wiring the SAME `useFStringInputAutocomplete` cursor-tracking directly
 * onto the AI-Assistant-enabled field too. This app's `AIAssistantInput`
 * accepts only `value`/`label`/`fieldName`/`language`/`disabled`/
 * `projectId`/`modelConfig`/`fieldBinding`/`fStringAutocomplete`/
 * `pipelineContext` -- its underlying base field has NO `onChange` wired
 * at all (verified by reading `AIAssistantInput.tsx`'s `buildInputBaseProps`
 * directly: only `value`/`label`/`disabled`/`name`/`id` are forwarded to
 * `InputBase`), so editing happens exclusively through the AI Assistant
 * modal (`fieldBinding.onInput` fires from the modal's `handleApply`/
 * `handleBlur`, not per keystroke on the base field) -- an intentional,
 * already-landed architecture change, not something this file can restore.
 * Consequently the F-string autocomplete popper + live cursor tracking
 * this file wires via `useFStringInputAutocomplete` only applies to the
 * plain `StyledInputEnhancer` branch; the AI-Assistant branch forwards
 * `fStringAutocomplete` straight to `AIAssistantInput`, which threads it
 * into its own modal (already-landed behaviour, not duplicated here).
 *
 * Also dropped: CodeMirror `language` syntax highlighting on the plain
 * branch -- `StyledInputEnhancer`'s own doc comment already discloses this
 * ("none of which exist in `shared/ui` yet").
 */
function NodeFieldInput(props: NodeFieldInputProps): ReactNode {
  const { shouldEnableAIAssistant, variable, value, disabled = false, onInput, variableName, enableFStringAutocomplete, stateVariableOptions, modelConfig = null } = props;

  const {
    closeAutocomplete,
    containerRef,
    filteredOptions: filteredStateVariableOptions,
    handleAutocompleteKeyDown,
    handleChange,
    handleCursorChange,
    handleSuggestionSelect,
    highlightedOptionIndex,
    inputRef,
  } = useFStringInputAutocomplete({
    resolvedValue: value,
    onInput,
    enabled: enableFStringAutocomplete && !disabled,
    options: stateVariableOptions.map(option => ({ label: option.label, value: option.value })),
  });

  const isChatHistory = variable === 'chat_history';

  /**
   * `handleCursorChange` (from `useFStringInputAutocomplete`) reads
   * `event.target.value`/`event.target.selectionStart` off whatever
   * element the DOM event actually fired on -- always the real `<input>`
   * at runtime, even though React's `MouseEvent<HTMLDivElement>`/
   * `FocusEvent<HTMLDivElement>`/`KeyboardEvent<HTMLDivElement>` handler
   * types (attached by `StyledInputEnhancer`'s `TextFieldProps`) declare
   * `target: EventTarget` generically. A local adapter (rather than passing
   * the hook's function reference directly, which `tsc` rejects -- the
   * declared `target: EventTarget` does not structurally satisfy the
   * hook's `{value?, selectionStart?}` shape even though both fields are
   * optional) preserves the baseline's identical runtime behaviour.
   */
  const toCursorTarget = (target: EventTarget | null): { value?: string; selectionStart?: number | null } =>
    target as unknown as { value?: string; selectionStart?: number | null };
  const onFieldClick = useCallback((event: MouseEvent<HTMLDivElement>) => handleCursorChange({ target: toCursorTarget(event.target) }), [handleCursorChange]);
  const onFieldFocus = useCallback((event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => handleCursorChange({ target: toCursorTarget(event.target) }), [handleCursorChange]);
  const onFieldKeyUp = useCallback((event: KeyboardEvent<HTMLDivElement>) => handleCursorChange({ target: toCursorTarget(event.target) }), [handleCursorChange]);

  return (
    <Box ref={containerRef}>
      {shouldEnableAIAssistant ? (
        <AIAssistantInput
          value={value}
          label={t('pipelines.simpleLLMInputItem.value', 'Value')}
          fieldName={variableName}
          disabled={disabled}
          modelConfig={modelConfig}
          fieldBinding={{ name: 'value', id: `${variable}-value`, onInput }}
          fStringAutocomplete={{ enabled: enableFStringAutocomplete, stateVariableOptions }}
        />
      ) : (
        <StyledInputEnhancer
          label={t('pipelines.simpleLLMInputItem.value', 'Value')}
          value={value}
          disabled={disabled}
          name="value"
          id={`${variable}-value`}
          {...(isChatHistory ? { expand: { minRows: 3, maxRows: 8 } } : {})}
          actions={{ enabled: true, showCopy: true, showFullScreen: true, showExpand: isChatHistory }}
          onChange={handleChange}
          onBlur={closeAutocomplete}
          onClick={onFieldClick}
          onFocus={onFieldFocus}
          onKeyDown={handleAutocompleteKeyDown}
          onKeyUp={onFieldKeyUp}
          inputRef={inputRef}
        />
      )}
      <FStringAutocompletePopper
        open={filteredStateVariableOptions.length > 0 && autocompleteIsOpen(shouldEnableAIAssistant, filteredStateVariableOptions.length)}
        anchorEl={containerRef.current}
        options={filteredStateVariableOptions}
        highlightedIndex={highlightedOptionIndex}
        onSelect={handleSuggestionSelect}
      />
    </Box>
  );
}

/** `filteredOptions.length > 0 && autocompleteState.isOpen` in the baseline -- collapsed here into a helper so `NodeFieldInput`'s JSX does not read `autocompleteState` directly (that hook value is already folded into `filteredOptions` staying empty when closed; kept as a named helper purely for readability parity with the baseline condition). */
function autocompleteIsOpen(shouldEnableAIAssistant: boolean, filteredCount: number): boolean {
  return !shouldEnableAIAssistant && filteredCount > 0;
}

export interface SimpleLLMInputItemProps {
  readonly variableName: string;
  readonly variable: string;
  readonly type: string;
  readonly value: unknown;
  readonly defaultValue: unknown;
  readonly onChangeMapping: (variable: string, value: SimpleLLMInputMappingValue) => void;
  readonly disabled?: boolean | undefined;
  readonly enableAIAssistant?: boolean;
  readonly modelConfig?: AiAssistantLlmSettings | null;
}

const containerSx: SxProps<Theme> = {};
const fieldRowSx: SxProps<Theme> = { display: 'flex', gap: '0.75rem', alignItems: 'flex-start', minHeight: '3.79rem' };
const typeSelectWrapperSx: SxProps<Theme> = { width: '7.25rem', transform: 'translateY(0.89rem)' };
const selectSx: SxProps<Theme> = { marginBottom: '0rem' };

function valueWrapperSx(isStringType: boolean): SxProps<Theme> {
  return { flex: 1, transform: isStringType ? undefined : 'translateY(0.89rem)' };
}

const AI_ASSISTANT_VARIABLE_NAMES: ReadonlySet<string> = new Set(['system', 'task', 'code', 'printer', 'user_message']);

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/SimpleLLMInputItem.jsx` (unit A2h). See `NodeFieldInput`'s doc
 * comment above for the AI-Assistant-branch redesign this file is built
 * around.
 */
export function SimpleLLMInputItem(props: SimpleLLMInputItemProps): ReactNode {
  const { variableName, variable, type, value, defaultValue, onChangeMapping, disabled = false, enableAIAssistant = false, modelConfig = null } = props;

  const typeOptions = useMemo<SingleSelectOption[]>(
    () => FlowEditorConstants.agentTaskTypeOptions.map(option => ({ label: option.label, value: option.value })),
    [],
  );
  const stateVariableOptions = useInputOptions();

  const resolvedValue = typeof value !== 'string' ? JSON.stringify(value) : value;

  const onChange = useCallback(
    (field: 'type' | 'value', newValue: string) => {
      if (field === 'type') {
        const shouldPreserveValue = (type === 'fstring' && newValue === 'fixed') || (type === 'fixed' && newValue === 'fstring');
        onChangeMapping(variable, { type: newValue, value: shouldPreserveValue ? value : defaultValue });
      } else {
        onChangeMapping(variable, { type, value: newValue });
      }
    },
    [onChangeMapping, variable, type, value, defaultValue],
  );

  const onInput = useCallback(
    (event: SimpleLLMInputChangeEvent) => {
      event.preventDefault();
      if (variableName.toLowerCase() === 'chat_history' && type === 'fixed') {
        try {
          const parsedValue: unknown = JSON.parse(event.target.value);
          onChangeMapping(variable, { type, value: parsedValue });
        } catch {
          onChange('value', event.target.value);
        }
      } else {
        onChange('value', event.target.value);
      }
    },
    [onChange, onChangeMapping, type, variable, variableName],
  );

  const shouldEnableAIAssistant = useMemo(
    () => enableAIAssistant && (type === 'fstring' || type === 'fixed') && AI_ASSISTANT_VARIABLE_NAMES.has(variableName),
    [enableAIAssistant, type, variableName],
  );

  const enableFStringAutocomplete = type === 'fstring' && FlowEditorConstants.FSTRING_AUTOCOMPLETE_VARIABLES.has(variableName);

  const isStringType = type === 'string' || type === 'fstring' || type === 'fixed';

  return (
    <Box sx={containerSx}>
      <HeadingChip label={capitalizeFirstChar(variableName.replaceAll('_', ' '))} />

      <Box sx={fieldRowSx}>
        <Box sx={typeSelectWrapperSx}>
          <SingleSelect
            sx={selectSx}
            label={t('pipelines.simpleLLMInputItem.type', 'Type')}
            value={type}
            onChange={newValue => onChange('type', newValue)}
            options={typeOptions}
            disabled={disabled}
          />
        </Box>
        <Box sx={valueWrapperSx(isStringType)}>
          {isStringType ? (
            <NodeFieldInput
              shouldEnableAIAssistant={shouldEnableAIAssistant}
              variable={variable}
              value={resolvedValue}
              disabled={disabled}
              onInput={onInput}
              variableName={variableName}
              enableFStringAutocomplete={enableFStringAutocomplete}
              stateVariableOptions={stateVariableOptions}
              modelConfig={modelConfig}
            />
          ) : (
            <SingleSelect
              sx={selectSx}
              label={t('pipelines.simpleLLMInputItem.value', 'Value')}
              value={typeof value === 'string' ? value : ''}
              onChange={newValue => onChange('value', newValue)}
              options={stateVariableOptions}
              disabled={disabled}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
