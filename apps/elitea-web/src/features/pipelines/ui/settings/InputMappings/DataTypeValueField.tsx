import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useCallback, useMemo, useRef } from 'react';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseCheckbox } from '@/shared/ui/BaseCheckbox';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';

import type { FStringAutocompleteOption } from '../../../lib/fStringAutocomplete';
import { useFStringInputAutocomplete } from '../../../model/useFStringInputAutocomplete';
import { FStringAutocompletePopper } from '../../FStringAutocompletePopper';
import { LabelWithTooltip } from './LabelWithTooltip';

/** Shape any real DOM change event or `useFStringInputAutocomplete`'s synthesised suggestion-commit event satisfies. */
export interface FStringChangeEventLike {
  preventDefault: () => void;
  readonly target: { readonly value: string; readonly selectionStart?: number | null };
}

const DATA_TYPE_PLACEHOLDER: Readonly<Record<string, string>> = {
  integer: 'input number',
  number: 'input number',
  object: '{}',
  array: '[]',
};

/**
 * `typeof val === 'object' ? JSON.stringify(val) : val` — baseline
 * `InputMappingItem.jsx:22`. Written as explicit type-narrowing branches
 * (rather than the baseline's own `typeof === 'object' ? ... : String(val)`
 * shape) so `String()` is only ever called on a `number`/`boolean` (safe,
 * per `typescript/no-base-to-string`) — a plain `String(value ?? '')` on
 * the untouched `unknown` fallback branch cannot be proven safe by that
 * rule (an unnarrowed `unknown` might still be an object/function/symbol
 * whose default `String()` coercion is `'[object Object]'`-style noise).
 */
function getDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** `Value of ${dataType} type is expected` — the tooltip text every `DataTypeValueField` value control shares, baseline `InputMappingItem.jsx` lines 244/255/274. */
function dataTypeExpectedTooltip(dataType: string): string {
  return t('pipelines.inputMapping.dataTypeExpected', 'Value of {{dataType}} type is expected', { dataType });
}

interface BooleanFieldProps {
  readonly value: unknown;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly disabled?: boolean | undefined;
  readonly tooltip: string;
}

/** Ported from baseline `InputMappingItem.jsx`'s inline `BooleanField` (lines 24-45). */
function BooleanField({ value, onChange, disabled, tooltip }: BooleanFieldProps): ReactNode {
  return (
    <FormControlLabel
      control={
        <BaseCheckbox
          checked={value === true}
          onChange={onChange}
          disabled={disabled}
          size="large"
        />
      }
      label={<LabelWithTooltip tooltip={<Typography variant="labelSmall">{tooltip}</Typography>} />}
      sx={formControlLabelSx}
      className="nopan nodrag"
      labelPlacement="start"
    />
  );
}

interface TextInputFieldProps {
  readonly value: unknown;
  readonly onInput: (event: FStringChangeEventLike) => void;
  readonly disabled?: boolean | undefined;
  readonly tooltip: string;
  readonly placeholder: string;
  readonly inputType?: string | undefined;
  readonly showTitle?: boolean | undefined;
  readonly multiline?: boolean | undefined;
  readonly enableFStringAutocomplete?: boolean | undefined;
  readonly stateVariableOptions: readonly FStringAutocompleteOption[];
}

/** `EventTarget` (what a real DOM event's `.target` is typed as when the listener sits on an ancestor, e.g. `onClick`/`onKeyUp` landing on `TextField`'s root `div` rather than its inner `input`/`textarea` — see this file's own doc comment) has no properties in common with `FStringChangeEventLike['target']`'s all-optional shape, which trips TS's "weak type" check on a plain structural cast. The event's `.target` genuinely IS the real `input`/`textarea` at runtime (native DOM events bubble with `target` set to the actual originating element, regardless of which ancestor the listener prop was declared on) — this narrows the type to match, it does not change runtime behaviour. */
function toCursorTarget(target: EventTarget | null): { value?: string; selectionStart?: number | null } {
  return target as { value?: string; selectionStart?: number | null };
}

/**
 * Ported from baseline `InputMappingItem.jsx`'s inline `TextInputField`
 * (lines 47-132). NOT ported: the baseline's `language` prop, which drove
 * `Input.StyledInputEnhancer`'s CodeMirror-backed editing surface for
 * `object`/`array` values (JSON syntax highlighting inside the field). This
 * app's ported `shared/ui/StyledInputEnhancer` (unit S1-F) is a plain
 * `TextField` wrapper — its own doc comment records the CodeMirror-backed
 * baseline surface as explicitly out of that unit's scope ("none of which
 * exist in `shared/ui` yet"). `object`/`array` values still render and edit
 * as plain (unhighlighted) JSON text below; no functionality is lost, only
 * syntax colouring.
 */
function TextInputField({
  value,
  onInput,
  disabled,
  tooltip,
  placeholder,
  inputType = 'text',
  showTitle = false,
  multiline = false,
  enableFStringAutocomplete = false,
  stateVariableOptions,
}: TextInputFieldProps): ReactNode {
  const resolvedValue = getDisplayValue(value);
  const valueLabel = t('pipelines.inputMapping.valueLabel', 'Value');
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    autocompleteState,
    closeAutocomplete,
    filteredOptions: filteredStateVariableOptions,
    handleAutocompleteKeyDown,
    handleChange,
    handleCursorChange,
    handleSuggestionSelect,
    highlightedOptionIndex,
    inputRef,
  } = useFStringInputAutocomplete({
    resolvedValue,
    onInput,
    enabled: enableFStringAutocomplete && !disabled,
    options: stateVariableOptions,
  });

  const popperSx = useMemo<SxProps<Theme>>(
    () => ({ width: containerRef.current?.clientWidth ?? undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measured on every render, matching the baseline's own un-memoised `textInputFieldPopperStyles(containerRef.current?.clientWidth)` call.
    [autocompleteState.isOpen],
  );

  // `StyledInputEnhancer`'s `onClick`/`onKeyUp` land on its `TextField`
  // root (an ancestor `div`, not the real `input`/`textarea` — see
  // `toCursorTarget`'s own doc comment), so they arrive typed
  // `MouseEvent<HTMLDivElement>`/`KeyboardEvent<HTMLDivElement>`, not the
  // `HTMLInputElement`-flavoured event `handleCursorChange` structurally
  // expects. Cursor position tracking only ever reads `event.target`, which
  // is the real originating element regardless of listener placement.
  const handleContainerClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => handleCursorChange({ target: toCursorTarget(event.target) }),
    [handleCursorChange],
  );
  const handleContainerKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => handleCursorChange({ target: toCursorTarget(event.target) }),
    [handleCursorChange],
  );

  return (
    <Box ref={containerRef}>
      <StyledInputEnhancer
        autoComplete="off"
        {...(multiline ? { expand: { maxRows: 3 } } : {})}
        {...(disabled !== undefined ? { disabled } : {})}
        fullWidth
        type={inputType}
        name="value"
        // Preserved baseline quirk — see `LabelWithTooltip`'s own doc
        // comment: this ternary always resolves to the same default label
        // text either way; `showTitle` therefore does not affect what
        // is rendered here, only the parenthesised note above documents why.
        label={
          <LabelWithTooltip
            tooltip={tooltip}
            title={showTitle ? valueLabel : undefined}
          />
        }
        placeholder={placeholder}
        value={resolvedValue}
        onChange={handleChange}
        onBlur={closeAutocomplete}
        onClick={handleContainerClick}
        onFocus={handleCursorChange}
        onKeyDown={handleAutocompleteKeyDown}
        onKeyUp={handleContainerKeyUp}
        actions={{ enabled: true, showCopy: false, showExpand: false }}
        className="nopan nodrag nowheel"
        inputRef={inputRef}
      />
      <FStringAutocompletePopper
        open={filteredStateVariableOptions.length > 0 && autocompleteState.isOpen}
        anchorEl={containerRef.current}
        options={filteredStateVariableOptions}
        highlightedIndex={highlightedOptionIndex}
        onSelect={handleSuggestionSelect}
        popperSx={popperSx}
      />
    </Box>
  );
}

/** @public features/pipelines UI — renders `InputMappingItem`'s fixed/f-string value control for one `dataType` (boolean/integer/number/object/array/string). */
export interface DataTypeValueFieldProps {
  readonly dataType: string;
  readonly type: string | undefined;
  readonly value: unknown;
  readonly onInput: (event: FStringChangeEventLike) => void;
  readonly onBooleanChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Threaded into `TextInputField`'s own `onInput` slot (the number branch renders a `TextInputField`, not a bespoke numeric widget) — typed to match that prop, not a raw DOM `ChangeEvent`. */
  readonly onNumberInput: (event: FStringChangeEventLike) => void;
  readonly disabled?: boolean | undefined;
  readonly multiline?: boolean | undefined;
  readonly stateVariableOptions: readonly FStringAutocompleteOption[];
}

/**
 * Ported from baseline `InputMappingItem.jsx`'s `renderDataTypeField`
 * `useMemo` (lines 233-295). Extracted to its own component rather than
 * kept as a `useMemo` with the baseline's own 11-entry dependency array
 * (`isStringType, dataType, type, value, onInput, disabled, onBooleanChange,
 * onNumberInput, mappingInfo, variable, inputOptions`) — this app's §3.5
 * hook-deps budget (≤8) forbids that array outright. As a real component,
 * every one of those values simply flows in as a prop and React's own
 * re-render model replaces the manual memo-dependency bookkeeping; no
 * behaviour change. `mappingInfo`/`variable` (only ever used by the
 * baseline to compute `isMultiline`) are collapsed into the single
 * `multiline` boolean the caller (`InputMappingItem`) already has to
 * compute anyway.
 */
export function DataTypeValueField({
  dataType,
  type,
  value,
  onInput,
  onBooleanChange,
  onNumberInput,
  disabled,
  multiline,
  stateVariableOptions,
}: DataTypeValueFieldProps): ReactNode {
  const placeholder = DATA_TYPE_PLACEHOLDER[dataType] ?? '';

  if (dataType === 'boolean' && type === 'fixed') {
    return (
      <BooleanField
        value={value}
        onChange={onBooleanChange}
        disabled={disabled}
        tooltip={dataTypeExpectedTooltip(dataType)}
      />
    );
  }

  if (dataType === 'integer' || dataType === 'number') {
    return (
      <TextInputField
        value={'' + (value as string | number)}
        onInput={onNumberInput}
        disabled={disabled}
        tooltip={dataTypeExpectedTooltip(dataType)}
        placeholder={placeholder}
        inputType="number"
        stateVariableOptions={stateVariableOptions}
      />
    );
  }

  const showTitle = dataType === 'object' || dataType === 'array';
  const jsonLikeValue =
    typeof value !== 'string' && (dataType === 'string' || dataType === 'object' || dataType === 'array' || dataType === 'boolean')
      ? JSON.stringify(value)
      : value;

  return (
    <TextInputField
      value={jsonLikeValue}
      onInput={onInput}
      disabled={disabled}
      tooltip={dataTypeExpectedTooltip(dataType)}
      placeholder={placeholder}
      showTitle={showTitle}
      multiline={multiline}
      enableFStringAutocomplete={type === 'fstring'}
      stateVariableOptions={stateVariableOptions}
    />
  );
}

const formControlLabelSx: SxProps<Theme> = {
  marginLeft: 0,
  height: '2.8125rem',
  alignItems: 'center',
};
