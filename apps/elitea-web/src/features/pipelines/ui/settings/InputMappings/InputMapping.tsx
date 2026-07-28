import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { capitalizeFirstChar } from '@/shared/lib/string';
import { BasicAccordion } from '@/shared/ui/BasicAccordion';

import * as FlowEditorHelpers from '../../../lib/flow-editor/helpers/flowEditor.helpers';
import type { YamlInputMappingEntry } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import { useInputOptions } from '../../../lib/flow-editor/hooks/useInputOptions';
import { InputMappingItem } from './InputMappingItem';
import type { OnChangeInputMapping } from './InputMappingItem';

/**
 * `input_mapping[key]`'s real shape, widened from the sibling A2c unit's
 * `YamlInputMappingEntry` (`../../../lib/flow-editor/helpers/
 * pipelineFlow.types.ts`, closed interface, no index signature). Baseline
 * `InputMapping.jsx:37,46` reads `input_mapping[key]?.title` (used to
 * compute a node's `variableName` fallback) — a real field this component
 * genuinely needs, just one `YamlInputMappingEntry` does not model (that
 * file is not in this sub-unit's owned list, so it cannot be edited here).
 * Intersecting locally adds the one missing optional field without forking
 * the rest of that type.
 */
type InputMappingEntry = YamlInputMappingEntry & { readonly title?: string };

/** `mappingInfo[key]?.value` / `values[key]?.value`, falling back to `[]` for an array `dataType`, `''` otherwise — baseline `InputMapping.jsx`'s module-level `getValue` (lines 12-20). */
function getValue(
  key: string,
  values: Readonly<Record<string, YamlInputMappingEntry>>,
  mappingInfo: Readonly<Record<string, YamlInputMappingEntry>>,
  dataType: string,
): unknown {
  if (values[key]?.value !== undefined) {
    return values[key].value;
  }
  if (mappingInfo[key]?.value !== undefined) {
    return mappingInfo[key].value;
  }
  return dataType === 'array' ? [] : '';
}

/** @public features/pipelines UI — the flow-editor node settings panel's "Input mapping" accordion (required + optional variable sections). */
export interface InputMappingProps {
  readonly input_mapping: Readonly<Record<string, InputMappingEntry>>;
  readonly mappingInfo?: Readonly<Record<string, YamlInputMappingEntry>> | undefined;
  readonly defaultValues?: Readonly<Record<string, unknown>> | undefined;
  readonly values?: Readonly<Record<string, YamlInputMappingEntry>> | undefined;
  readonly onChangeMapping: OnChangeInputMapping;
  readonly requiredInputs?: readonly string[] | undefined;
  readonly disabled?: boolean | undefined;
  readonly sx?: SxProps<Theme> | undefined;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/InputMappings/InputMapping.jsx` (baseline, 139 lines) — unit
 * A2i.
 *
 * DISCLOSED REDESIGN, forced by a real, verified constraint: the baseline
 * renders BOTH the "required" and "optional" sections as two entries of a
 * SINGLE `BasicAccordion`'s `items` array, each with its own
 * `itemDefaultExpanded` (required starts open, optional starts closed).
 * This app's already-ported `shared/ui/BasicAccordion` (unit S1-B) has no
 * per-item expand state — `defaultExpanded`/`expanded` are single props
 * applied uniformly to every item in the list (confirmed: `AccordionItem`'s
 * own interface has no such field, and `BasicAccordion`'s render applies
 * one `defaultExpanded`/`expanded` pair to every `StyledAccordion` it
 * renders). Two independently-configured accordion panels therefore need
 * two separate `BasicAccordion` instances (each with exactly one item),
 * stacked in a `Box`, rather than one `BasicAccordion` with a two-entry
 * `items` array — same rendered structure and default-expand behaviour,
 * just two component instances instead of one with an unsupported
 * per-item override.
 *
 * `style` (baseline prop name) is renamed `sx`, forwarded to each
 * `BasicAccordion`'s own `slotSx.root` — matching this app's `sx`-prop
 * convention (`ApplicationTools.tsx`, a sibling Wave-2 unit, does the same
 * baseline-`style`-prop -> `sx` rename for the identical reason).
 *
 * `summarySX`'s baseline `minHeight: '2rem !important'` drops its
 * `!important` — R-T5 bans it outright app-wide, with no waiver on file for
 * this unit; `minHeight: '2rem'` alone is sufficient here (nothing else in
 * this app's `MuiAccordionSummary`/`StyledAccordionSummary` styling
 * contests that property at higher specificity).
 */
export function InputMapping({
  input_mapping,
  mappingInfo = {},
  defaultValues = {},
  values = {},
  onChangeMapping,
  requiredInputs = [],
  disabled,
  sx,
}: InputMappingProps): ReactNode {
  const inputOptions = useInputOptions();

  const renderMappingItem = useCallback(
    (key: string, keyPrefix: string) => {
      const mapping = input_mapping[key];
      const type = values[key]?.type ?? mappingInfo[key]?.type ?? mapping?.type;
      const enumList = FlowEditorHelpers.getEnumList(type, mappingInfo[key]?.enum, inputOptions);
      const dataType = mappingInfo[key]?.data_type ?? 'string';
      const value = getValue(key, values, mappingInfo, dataType);
      return (
        <InputMappingItem
          key={`${keyPrefix}-${key}`}
          variableName={mapping?.title ?? capitalizeFirstChar(key.replaceAll('_', ' '))}
          variable={key}
          type={type}
          dataType={dataType}
          value={value}
          enumList={enumList}
          onChangeMapping={onChangeMapping}
          disabled={disabled}
          tooltip={mappingInfo[key]?.tooltip}
          defaultValues={defaultValues}
          mappingInfo={mappingInfo}
        />
      );
    },
    [input_mapping, values, mappingInfo, inputOptions, defaultValues, onChangeMapping, disabled],
  );

  const { requiredKeys, optionalKeys } = useMemo(() => {
    const keys = Object.keys(input_mapping);
    return {
      requiredKeys: keys.filter((key) => requiredInputs.includes(key)),
      optionalKeys: keys.filter((key) => !requiredInputs.includes(key)),
    };
  }, [input_mapping, requiredInputs]);

  return (
    <Box sx={sx}>
      {requiredKeys.length > 0 && (
        <BasicAccordion
          showMode="left"
          defaultExpanded
          slotSx={accordionSlotSx}
          items={[
            {
              title: `Input mapping (required ${requiredKeys.length})`,
              content: (
                <Box
                  className="nowheel"
                  sx={requiredContentSx}
                >
                  {requiredKeys.map((key) => renderMappingItem(key, 'required'))}
                </Box>
              ),
            },
          ]}
        />
      )}
      {optionalKeys.length > 0 && (
        <BasicAccordion
          showMode="left"
          defaultExpanded={false}
          slotSx={accordionSlotSx}
          items={[
            {
              title: `Input mapping (optional ${optionalKeys.length})`,
              content: <Box sx={optionalContentSx}>{optionalKeys.map((key) => renderMappingItem(key, 'optional'))}</Box>,
            },
          ]}
        />
      )}
    </Box>
  );
}

const accordionSlotSx: {
  accordion: SxProps<Theme>;
  summary: SxProps<Theme>;
  title: SxProps<Theme>;
  details: SxProps<Theme>;
} = {
  accordion: (theme: Theme) => ({
    background: theme.vars.palette.background.tabPanel,
  }),
  summary: (theme: Theme) => ({
    background: theme.vars.palette.background.userInputBackground,
    borderRadius: theme.vars.shape.radiusMd,
    minHeight: '2rem',
  }),
  title: (theme: Theme) => ({
    color: theme.vars.palette.text.secondary,
  }),
  details: {
    paddingLeft: '0rem',
    gap: '0.5rem',
  },
};

const requiredContentSx: SxProps<Theme> = {
  maxHeight: '13.125rem',
  overflow: 'auto',
};

const optionalContentSx: SxProps<Theme> = {
  overflow: 'auto',
};
