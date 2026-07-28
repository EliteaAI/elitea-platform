import type { ComponentType, RefObject, ReactNode } from 'react';
import { useEffect, useMemo } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';
import { SingleSelect } from '@/shared/ui/SingleSelect';

import { IndexesToolsEnum } from '../../lib/constants/indexDetails.constants';
import type { JsonSchemaLike } from '../../lib/helpers/indexChat.helpers';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/ui/
 * IndexDetails/IndexConfig.jsx` (unit A4a). Renders one schema-driven form
 * (index-data config, or a run-tool's input form) plus, when `toolsConfig`
 * is supplied, the tool picker and Run button used by the "Run" tab.
 *
 * DISCLOSED DI: the baseline renders `ToolkitForm.ToolFormContainer`
 * (`features/toolkits/ui/form/ToolkitForm`) for each schema property. That
 * component is explicitly named in this unit's brief as "NOT promoted and
 * remains yours to build IF it's in your owned list" — it is NOT in A4a's
 * owned-file list (only the `indexes/` sub-tree is), so it belongs to a
 * different, not-yet-landed toolkits sub-unit, in the SAME `features/
 * toolkits` slice (a legal intra-slice import once it lands — R-L3). Until
 * then there is nothing on disk at that path to import (verified: no
 * `features/toolkits/ui` directory exists yet in this worktree), so
 * `ToolFormField` is an injected component prop instead of a static import
 * — keeps this file (and its tests) real and green today, and the real
 * component drops in with zero call-site changes once its sub-unit lands
 * (the prop's shape mirrors the baseline's exact call args).
 */
export interface ToolFormFieldProps {
  readonly fieldKey: string;
  readonly property: Record<string, unknown>;
  readonly toolInputVariables: unknown;
  readonly schema: JsonSchemaLike;
  readonly onChangeInputVariables: (value: Record<string, unknown>) => void;
  readonly changesDisabled?: boolean | undefined;
}

export interface IndexConfigToolsConfig {
  readonly selectedRunTool: string | null;
  readonly onChangeTool: (tool: { value: string | null }) => void;
  readonly handleRunTool: () => void;
  readonly selectedIndexTools: readonly string[];
}

export interface IndexConfigProps {
  readonly schema: JsonSchemaLike | null | undefined;
  readonly configInitialized: RefObject<boolean>;
  readonly initializeDefaultConfigValues: () => void;
  readonly toolInputVariables: Record<string, unknown>;
  readonly onChangeInputVariables: (value: Record<string, unknown>) => void;
  readonly toolsConfig?: IndexConfigToolsConfig | null | undefined;
  readonly isValidForm?: boolean | undefined;
  readonly changesDisabled?: boolean | undefined;
  readonly withNavigation?: boolean | undefined;
  readonly isRunningTool?: boolean | undefined;
  readonly ToolFormField: ComponentType<ToolFormFieldProps>;
  readonly sx?: SxProps<Theme> | undefined;
}

const RUN_TOOL_OPTIONS = [
  { label: 'Search Index', value: IndexesToolsEnum.searchIndexData },
  { label: 'Stepback Search Index', value: IndexesToolsEnum.stepbackSearchIndex },
  { label: 'Stepback Summary Index', value: IndexesToolsEnum.stepbackSummaryIndex },
];

export function IndexConfig(props: IndexConfigProps): ReactNode {
  const {
    schema,
    configInitialized,
    initializeDefaultConfigValues,
    toolInputVariables,
    onChangeInputVariables,
    toolsConfig = null,
    isValidForm,
    changesDisabled,
    withNavigation,
    isRunningTool,
    ToolFormField,
    sx,
  } = props;

  useEffect(() => {
    if (schema?.properties && !configInitialized.current) initializeDefaultConfigValues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, initializeDefaultConfigValues]);

  const configValues = useMemo(() => Object.keys(schema?.properties ?? {}), [schema]);

  const toolsOptions = useMemo(() => {
    if (!toolsConfig) return [];
    return RUN_TOOL_OPTIONS.filter((opt) => toolsConfig.selectedIndexTools.includes(opt.value));
  }, [toolsConfig]);

  return (
    <Box sx={combineSx({ flexGrow: 1, padding: 0 }, sx)}>
      <Box
        sx={{
          height: `calc(100vh - 3.75rem - 3.75rem - 3rem${withNavigation ? ' - 1.75rem - 1.5rem' : ''})`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
        }}
      >
        <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative', ...(withNavigation && { marginBottom: '1rem' }) }}>
          {toolsConfig && (
            <Box>
              <SingleSelect
                label={t('features.toolkits.indexConfig.toolLabel', 'Tool')}
                value={toolsConfig.selectedRunTool ?? ''}
                onChange={(selectedValue) => toolsConfig.onChangeTool({ value: selectedValue || null })}
                options={toolsOptions}
              />
            </Box>
          )}
          {schema &&
            configValues.map((key) => (
              <ToolFormField
                key={key}
                fieldKey={key}
                property={(schema.properties?.[key] ?? {}) as Record<string, unknown>}
                toolInputVariables={toolInputVariables}
                schema={schema}
                onChangeInputVariables={onChangeInputVariables}
                changesDisabled={changesDisabled}
              />
            ))}
        </Box>
        {toolsConfig && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '1.75rem' }}>
            <Button
              variant="special"
              fullWidth
              disabled={!isValidForm || isRunningTool}
              onClick={toolsConfig.handleRunTool}
              sx={{ width: '3.625rem' }}
            >
              {t('features.toolkits.indexConfig.runButton', 'Run')}
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
