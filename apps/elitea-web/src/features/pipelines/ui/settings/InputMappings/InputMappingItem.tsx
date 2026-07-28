import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { HeadingChip } from '@/shared/ui/HeadingChip';
import { SingleSelect } from '@/shared/ui/SingleSelect';

import { agentTaskTypeOptions } from '../../../lib/flow-editor/constants/flowEditor.constants';
import * as FlowEditorHelpers from '../../../lib/flow-editor/helpers/flowEditor.helpers';
import type { YamlInputMappingEntry } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import { useInputOptions } from '../../../lib/flow-editor/hooks/useInputOptions';
import { DataTypeValueField } from './DataTypeValueField';
import type { FStringChangeEventLike } from './DataTypeValueField';
import { EnumMultiSelectField } from './EnumMultiSelectField';
import { LabelWithTooltip } from './LabelWithTooltip';

/** One `input_mapping[key]`/`mappingInfo[key]` write, as handed to the caller-owned `onChangeMapping` — matches `YamlInputMappingEntry`'s writable subset. */
interface InputMappingChangePayload {
  readonly type: string;
  readonly value: unknown;
  readonly enum?: readonly unknown[];
}

export type OnChangeInputMapping = (variable: string, value: InputMappingChangePayload, dataType: string) => void;

/** @public features/pipelines UI — one row of `InputMapping`'s required/optional accordion: a variable's type selector + fixed/f-string/variable value control. */
export interface InputMappingItemProps {
  readonly variableName: string;
  readonly type: string | undefined;
  readonly dataType: string;
  readonly value: unknown;
  readonly enumList: readonly unknown[] | undefined;
  readonly variable: string;
  readonly onChangeMapping: OnChangeInputMapping;
  readonly disabled?: boolean | undefined;
  readonly tooltip?: string | undefined;
  readonly defaultValues: Readonly<Record<string, unknown>>;
  readonly mappingInfo: Readonly<Record<string, YamlInputMappingEntry>>;
}

/** Safe for any `unknown` (per `typescript/no-base-to-string`) — `String()` only ever runs on a `number`/`boolean`/`string`; anything else stringifies via `JSON.stringify`. */
function toDisplayString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function toEnumOptions(enumList: readonly unknown[] | undefined): { label: string; value: string }[] {
  return enumList?.map((item) => ({ label: toDisplayString(item), value: toDisplayString(item) })) ?? [];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(toDisplayString) : [];
}

interface ValueControlProps {
  readonly hasEnum: boolean;
  readonly isArrayEnum: boolean;
  readonly isStringType: boolean;
  readonly enumSingleSelect: ReactNode;
  readonly enumMultiSelect: ReactNode;
  readonly dataTypeField: ReactNode;
  readonly fallbackSelect: ReactNode;
}

/**
 * Picks which of `InputMappingItem`'s four pre-built value controls to
 * render. Extracted out of `InputMappingItem` itself purely to keep that
 * component's own cyclomatic complexity under the §3.5 budget (12) — the
 * baseline's four-way ternary chain this replaces (`enumList?.length ?
 * (dataType !== 'array' || type === 'variable' ? ... : ...) : isStringType
 * ? ... : ...`, `InputMappingItem.jsx` lines 326-364) measured 16 when left
 * inline. No behaviour change: each branch below renders the exact same
 * pre-constructed element the inline ternary would have.
 */
function ValueControl({
  hasEnum,
  isArrayEnum,
  isStringType,
  enumSingleSelect,
  enumMultiSelect,
  dataTypeField,
  fallbackSelect,
}: ValueControlProps): ReactNode {
  if (hasEnum) return isArrayEnum ? enumMultiSelect : enumSingleSelect;
  if (isStringType) return dataTypeField;
  return fallbackSelect;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/InputMappings/InputMappingItem.jsx` (baseline, 428 lines) — unit
 * A2i. Split into this file (the item's own type/value control logic) plus
 * `./DataTypeValueField.tsx` (the baseline's inline `BooleanField`/
 * `TextInputField`/`renderDataTypeField`) and `./EnumMultiSelectField.tsx`
 * (the baseline's `dataType === 'array'` multi-value branch) to satisfy the
 * §3.5 400-line file-length budget and the ≤8-entry hook-deps budget (the
 * baseline's own `renderDataTypeField` `useMemo` carries 11 dependencies —
 * see `DataTypeValueField.tsx`'s own doc comment). The render's own
 * four-way value-control ternary is further extracted to `ValueControl`
 * above, for the §3.5 12-complexity budget (see its own doc comment).
 *
 * DEVIATIONS FROM BASELINE, all forced by real, verified constraints:
 *  - `Chip.HeadingChip` / `Select.SingleSelect` / `Checkbox.BaseCheckbox` /
 *    `Input.StyledInputEnhancer` (baseline: the old app's `shared/ui`
 *    barrel namespace exports) map onto this app's already-ported
 *    `HeadingChip` / `SingleSelect` / `BaseCheckbox` / `StyledInputEnhancer`
 *    (units S1-D/S1-F/S1-G) — same components, flat named imports (R-L3:
 *    entered through each slice's own `index.ts`).
 *  - This app's `SingleSelect` (unit S1-D) has no `className` prop (its own
 *    doc comment: a deliberate 50→12-prop trim). The baseline set
 *    `className="nopan nodrag"` directly on each `Select.SingleSelect` so
 *    React Flow's canvas excludes it from pan/drag gestures (checked via
 *    `closest()` against the event target's ancestors — the exact class on
 *    the ancestor chain does not need to be the Select's own root). Moved
 *    one level up, onto this component's own wrapping `Box`es
 *    (`typeSelectWrapperSx`/`valueWrapperSx`), matching the identical fix
 *    `YamlCodeEditor.tsx` (a sibling A2 unit) already applied for the same
 *    reason.
 *  - Baseline `InputMapping.jsx` passes an extra `title={mapping?.title}`
 *    prop into this component that `InputMappingItem.jsx` never destructures
 *    (grep-confirmed: absent from its own props list) — dead in the
 *    baseline. Not carried over; see `InputMappingItem`'s prop list above,
 *    which matches every prop this component actually reads.
 *  - `SingleSelect.label` (unit S1-D) is typed `string`, not `ReactNode`
 *    (confirmed by reading its prop interface) — the baseline's
 *    `label={<LabelWithTooltip tooltip="Select one option" />}` cannot be
 *    passed there. The plain tooltip TEXT is used as the label string
 *    instead at every `SingleSelect` call site below; `EnumMultiSelectField`
 *    (this sub-unit's own component, `label: ReactNode`) keeps the rich
 *    `LabelWithTooltip` node, since it renders into a plain `InputLabel`
 *    that accepts one.
 */
export function InputMappingItem({
  variableName,
  type,
  dataType,
  value,
  enumList,
  variable,
  onChangeMapping,
  disabled,
  tooltip,
  defaultValues,
  mappingInfo,
}: InputMappingItemProps): ReactNode {
  const inputOptions = useInputOptions();
  const isStringType = type === 'string' || type === 'fstring' || type === 'fixed';
  const typeOptions = useMemo(() => [...agentTaskTypeOptions], []);
  const typeLabel = t('pipelines.inputMapping.typeLabel', 'Type');
  const selectOneOptionLabel = t('pipelines.inputMapping.selectOneOption', 'Select one option');

  const onChangeType = useCallback(
    (newType: string) => {
      // Preserve value when switching between 'fstring' and 'fixed'.
      // Clear value when switching to/from 'variable'.
      const enumListForNewType = FlowEditorHelpers.getEnumList(newType, mappingInfo[variable]?.enum, inputOptions);
      const defaultValue = FlowEditorHelpers.getInputMappingDefaultValue(
        enumListForNewType,
        newType !== 'variable' ? dataType : 'string',
        defaultValues,
        variable,
      );
      const shouldPreserveValue =
        (type === 'fstring' && newType === 'fixed') || (type === 'fixed' && newType === 'fstring');
      const newValue = shouldPreserveValue ? value : defaultValue;
      const formattedValue = newType === 'fstring' ? FlowEditorHelpers.formatFStringValue(newValue) : newValue;
      onChangeMapping(variable, { type: newType, value: formattedValue }, dataType);
    },
    [mappingInfo, variable, inputOptions, dataType, defaultValues, type, value, onChangeMapping],
  );

  const onChangeValue = useCallback(
    (newValue: unknown) => {
      onChangeMapping(
        variable,
        { type: type ?? '', value: newValue, ...(enumList?.length ? { enum: enumList } : {}) },
        dataType,
      );
    },
    [variable, type, onChangeMapping, dataType, enumList],
  );

  const onInput = useCallback(
    (event: FStringChangeEventLike) => {
      event.preventDefault();
      if (dataType === 'object' || dataType === 'array') {
        try {
          const parsedValue = JSON.parse(event.target.value) as unknown;
          onChangeValue(parsedValue);
          return;
        } catch {
          onChangeValue(event.target.value);
        }
      } else {
        onChangeValue(event.target.value);
      }
    },
    [dataType, onChangeValue],
  );

  const onBooleanChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChangeValue(event.target.checked);
    },
    [onChangeValue],
  );

  const onNumberInput = useCallback(
    (event: FStringChangeEventLike) => {
      event.preventDefault();
      const newValue = event.target.value;
      const numValue = dataType === 'integer' ? parseInt(newValue, 10) : parseFloat(newValue);
      onChangeValue(Number.isNaN(numValue) ? newValue : numValue);
    },
    [onChangeValue, dataType],
  );

  const isMultiline = mappingInfo[variable]?.multiline === true;
  const enumOptions = useMemo(() => toEnumOptions(enumList), [enumList]);
  const stringValue = toDisplayString(value);
  const disabledProp = disabled !== undefined ? { disabled } : {};
  const hasEnum = Boolean(enumList?.length);
  const isArrayEnum = dataType === 'array' && type !== 'variable';

  const enumSingleSelect = (
    <Box className="nopan nodrag">
      <SingleSelect
        sx={selectSx}
        label={selectOneOptionLabel}
        value={stringValue}
        onChange={onChangeValue}
        options={enumOptions}
        {...disabledProp}
      />
    </Box>
  );

  const enumMultiSelect = (
    <Box className="nopan nodrag">
      <EnumMultiSelectField
        label={<LabelWithTooltip tooltip={t('pipelines.inputMapping.selectOptions', 'Select options')} />}
        value={toStringArray(value)}
        options={enumOptions}
        onChange={onChangeValue}
      />
    </Box>
  );

  const dataTypeField = (
    <DataTypeValueField
      dataType={dataType}
      type={type}
      value={value}
      onInput={onInput}
      onBooleanChange={onBooleanChange}
      onNumberInput={onNumberInput}
      disabled={disabled}
      multiline={isMultiline}
      stateVariableOptions={inputOptions}
    />
  );

  const fallbackSelect = (
    <Box className="nopan nodrag">
      <SingleSelect
        sx={selectSx}
        label={selectOneOptionLabel}
        value={stringValue}
        onChange={onChangeValue}
        options={inputOptions}
        {...disabledProp}
      />
    </Box>
  );

  return (
    <Box sx={containerSx}>
      <Box sx={labelRowSx}>
        <HeadingChip label={variableName} />
        {tooltip && (
          <LabelWithTooltip
            tooltip={tooltip}
            title=""
          />
        )}
      </Box>
      <Box sx={fieldRowSx}>
        <Box
          sx={typeSelectWrapperSx}
          className="nopan nodrag"
        >
          <SingleSelect
            sx={selectSx}
            label={typeLabel}
            value={type ?? ''}
            onChange={onChangeType}
            options={typeOptions}
            disabled={Boolean(disabled) || dataType === 'boolean'}
          />
        </Box>
        <Box sx={valueWrapperSx}>
          <ValueControl
            hasEnum={hasEnum}
            isArrayEnum={isArrayEnum}
            isStringType={isStringType}
            enumSingleSelect={enumSingleSelect}
            enumMultiSelect={enumMultiSelect}
            dataTypeField={dataTypeField}
            fallbackSelect={fallbackSelect}
          />
        </Box>
      </Box>
    </Box>
  );
}

const containerSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  paddingTop: '1rem',
};

const labelRowSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
};

const fieldRowSx: SxProps<Theme> = {
  marginTop: '1rem',
  display: 'flex',
  gap: '1.1875rem',
  width: '100%',
  alignItems: 'flex-end',
  height: '2.8125rem',
};

const typeSelectWrapperSx: SxProps<Theme> = {
  width: '7.25rem',
};

const valueWrapperSx: SxProps<Theme> = {
  flex: 1,
};

const selectSx: SxProps<Theme> = {
  marginBottom: '0rem',
};
