import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { capitalizeFirstChar } from '@/shared/lib/string';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { SingleSelect } from '@/shared/ui/SingleSelect';
import { StyledInputEnhancer } from '@/shared/ui/StyledInputEnhancer';

import { agentTaskTypeOptions } from '../../lib/flow-editor/constants/flowEditor.constants';
import { useInputOptions } from '../../lib/flow-editor/hooks/useInputOptions';
import { LabelWithTooltip } from './InputMappings/LabelWithTooltip';

/** One `variables_mapping[key]` entry — a router/decision output's downstream variable binding. Not modelled by the sibling A2c unit's `pipelineFlow.types.ts` (`YamlPipelineNode.variables_mapping` is deliberately left `Readonly<Record<string, unknown>>` there), so declared locally. */
export interface VariablesMappingEntry {
  readonly type: string;
  readonly source?: string;
  readonly value: unknown;
}

export type OnChangeVariablesMapping = (field: string, value: VariablesMappingEntry) => void;

const variableSourceOptions = [
  { label: 'State', value: 'state' },
  { label: 'Tool', value: 'tool' },
];

interface VariablesMappingItemProps {
  readonly fieldLabel?: string | undefined;
  readonly fieldName: string;
  readonly fieldValue: VariablesMappingEntry;
  readonly onChangeMapping: OnChangeVariablesMapping;
  readonly disabled?: boolean | undefined;
}

/** Ported from baseline `VariablesMapping.jsx`'s inline `VariablesMappingItem` (lines 26-180). */
function VariablesMappingItem({ fieldLabel, fieldName, fieldValue, onChangeMapping, disabled }: VariablesMappingItemProps): ReactNode {
  const inputOptions = useInputOptions();
  const typeLabel = t('pipelines.variablesMapping.typeLabel', 'Type');
  const sourceLabel = t('pipelines.variablesMapping.sourceLabel', 'Source');
  // Preserved baseline copy verbatim, including its own inconsistency:
  // `VariablesMapping.jsx` line 143 (the text-input branch) literally reads
  // "not tooltips here", while line 164 (the state-variable-select branch,
  // `inputValueSelectLabel` below) reads "no tooltips here" — two different
  // strings, almost certainly a baseline typo, not something this port
  // corrects.
  const textInputLabel = t('pipelines.variablesMapping.textInputLabel', 'not tooltips here');
  const inputValueSelectLabel = t('pipelines.variablesMapping.inputValueSelectLabel', 'no tooltips here');

  const label = useMemo(
    () => fieldLabel ?? capitalizeFirstChar(fieldName.replaceAll('_', ' ')),
    [fieldLabel, fieldName],
  );

  const onChangeFieldValue = useCallback(
    (field: 'type' | 'source' | 'value', newValue: unknown) => {
      let resolvedValue = newValue;
      if (fieldValue.type === 'fixed' && field === 'value' && typeof newValue === 'string') {
        try {
          resolvedValue = JSON.parse(newValue) as unknown;
        } catch {
          // Preserved baseline quirk: an unparsable fixed value is kept as
          // the raw string the user typed rather than rejected.
        }
      }
      onChangeMapping(fieldName, { ...fieldValue, [field]: resolvedValue });
    },
    [onChangeMapping, fieldName, fieldValue],
  );

  const onInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      event.preventDefault();
      onChangeFieldValue('value', event.target.value);
    },
    [onChangeFieldValue],
  );

  const onChangeType = useCallback((v: string) => onChangeFieldValue('type', v), [onChangeFieldValue]);
  const onChangeSource = useCallback((v: string) => onChangeFieldValue('source', v), [onChangeFieldValue]);
  const onChangeValueOption = useCallback((v: string) => onChangeFieldValue('value', v), [onChangeFieldValue]);

  const showInput = useMemo(
    () =>
      ['string', 'fstring', 'fixed'].includes(fieldValue.type) ||
      (fieldValue.source !== 'state' && fieldValue.source !== undefined),
    [fieldValue.source, fieldValue.type],
  );

  const showSource = useMemo(() => ['variable', 'fstring'].includes(fieldValue.type), [fieldValue.type]);

  useEffect(() => {
    if (!showSource && fieldValue.source !== undefined) {
      onChangeFieldValue('source', undefined);
    }
  }, [fieldValue.source, onChangeFieldValue, showSource]);

  const displayValue = typeof fieldValue.value !== 'string' ? JSON.stringify(fieldValue.value) : fieldValue.value;

  return (
    <Box sx={itemContainerSx}>
      <Typography
        component="div"
        variant="subtitle"
        color="text.secondary"
        sx={labelChipSx}
      >
        {label}
      </Typography>
      <Box sx={fieldRowSx}>
        <Box
          sx={typeSelectWrapperSx}
          className="nopan nodrag"
        >
          <SingleSelect
            sx={selectSx}
            label={typeLabel}
            value={fieldValue.type}
            onChange={onChangeType}
            options={typeOptions}
            {...(disabled !== undefined ? { disabled } : {})}
          />
        </Box>
        {showSource && (
          <Box
            sx={typeSelectWrapperSx}
            className="nopan nodrag"
          >
            <SingleSelect
              sx={selectSx}
              label={sourceLabel}
              value={fieldValue.source ?? 'state'}
              onChange={onChangeSource}
              options={variableSourceOptions}
              {...(disabled !== undefined ? { disabled } : {})}
            />
          </Box>
        )}
        <Box sx={valueWrapperSx}>
          {showInput && (
            <StyledInputEnhancer
              autoComplete="off"
              {...(disabled !== undefined ? { disabled } : {})}
              fullWidth
              name="value"
              label={<LabelWithTooltip tooltip={textInputLabel} />}
              placeholder=""
              value={displayValue}
              onChange={onInput}
              actions={{ enabled: true, showCopy: false, showExpand: false }}
              className="nopan nodrag nowheel"
            />
          )}
          {!showInput && fieldValue.type === 'variable' && (
            <Box className="nopan nodrag">
              <SingleSelect
                sx={selectSx}
                label={inputValueSelectLabel}
                value={typeof fieldValue.value === 'string' ? fieldValue.value : ''}
                onChange={onChangeValueOption}
                options={inputOptions}
                {...(disabled !== undefined ? { disabled } : {})}
              />
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** @public features/pipelines UI — the flow-editor node settings panel's "Variables mapping" accordion (router/decision downstream output bindings). */
export interface VariablesMappingProps {
  readonly variables_mapping?: Readonly<Record<string, VariablesMappingEntry>> | undefined;
  readonly onChangeMapping: OnChangeVariablesMapping;
  readonly disabled?: boolean | undefined;
  readonly sx?: SxProps<Theme> | undefined;
}

const typeOptions = [...agentTaskTypeOptions];

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/VariablesMapping.jsx` (baseline, 231 lines) — unit A2i.
 *
 * DEVIATIONS FROM BASELINE:
 *  - `onDeleteMapping` (baseline prop, threaded down to
 *    `VariablesMappingItem` but never read there — no delete affordance
 *    exists anywhere in this file's JSX; grep-confirmed dead in the
 *    baseline) is dropped, matching the sibling `InputMapping.jsx`'s own
 *    dead `title` prop, same treatment.
 *  - The baseline's `{ (style, variables_mapping, onChangeMapping,
 *    onDeleteMapping, disabled); }` block (`VariablesMapping.jsx:184-186`)
 *    is a bare comma-expression statement with no side effect at all — not
 *    ported; omitting a literal no-op changes no behaviour.
 *  - `style` (baseline prop name) is renamed `sx`, matching the identical
 *    rename `InputMapping.tsx` (this same sub-unit) already applies, for
 *    the same reason (see that file's own doc comment).
 *  - `Select.SingleSelect`/`Input.StyledInputEnhancer`'s baseline
 *    `className="nopan nodrag"`/`containerProps.className` map onto this
 *    app's `SingleSelect`/`StyledInputEnhancer` (units S1-D/S1-F), neither
 *    of which exposes a `className` prop for that exact purpose — moved to
 *    a wrapping `Box` (`SingleSelect`) or passed straight through
 *    `StyledInputEnhancer`'s own `...rest` onto its underlying `TextField`
 *    root (`className` is not excluded from its prop surface), same fix
 *    `InputMapping.tsx`/`DataTypeValueField.tsx` already apply.
 *  - The value-column `SingleSelect`'s baseline `label={<LabelWithTooltip
 *    tooltip="no tooltips here" />}` becomes a plain string label (`"no
 *    tooltips here"`) — `SingleSelect.label` is typed `string`, not
 *    `ReactNode` (unit S1-D); see `InputMappingItem.tsx`'s own doc comment
 *    for the identical, already-documented fix.
 */
export function VariablesMapping({ variables_mapping = {}, onChangeMapping, disabled, sx }: VariablesMappingProps): ReactNode {
  const entries = Object.keys(variables_mapping);

  return (
    <Box sx={sx}>
      <BasicAccordion
        showMode="left"
        slotSx={accordionSlotSx}
        items={[
          {
            title: `Variables mapping(${entries.length})`,
            content: (
              <Box>
                {entries.map((key) => (
                  <VariablesMappingItem
                    key={key}
                    fieldName={key}
                    fieldValue={variables_mapping[key] as VariablesMappingEntry}
                    onChangeMapping={onChangeMapping}
                    disabled={disabled}
                  />
                ))}
              </Box>
            ),
          },
        ]}
      />
    </Box>
  );
}

const accordionSlotSx: { accordion: SxProps<Theme>; summary: SxProps<Theme>; title: SxProps<Theme>; details: SxProps<Theme> } = {
  accordion: (theme: Theme) => ({ background: theme.vars.palette.background.tabPanel }),
  summary: (theme: Theme) => ({
    background: theme.vars.palette.background.userInputBackground,
    borderRadius: theme.vars.shape.radiusMd,
    minHeight: '2rem',
  }),
  title: (theme: Theme) => ({ color: theme.vars.palette.text.secondary }),
  details: { paddingLeft: '0rem' },
};

const itemContainerSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  paddingTop: '1rem',
};

const labelChipSx: SxProps<Theme> = (theme: Theme) => ({
  borderRadius: theme.vars.shape.radiusSm,
  border: `0.0625rem solid ${theme.vars.palette.border.flowNode}`,
  background: theme.vars.palette.background.userInputBackground,
  padding: '0.25rem 0.625rem',
  height: '1.5rem',
  width: 'auto',
});

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
