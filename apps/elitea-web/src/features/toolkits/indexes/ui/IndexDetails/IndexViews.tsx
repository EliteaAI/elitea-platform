import type { ComponentType, RefObject, ReactNode } from 'react';
import { useMemo } from 'react';

import { EditViewTabsEnum } from '../../lib/constants/indexDetails.constants';
import type { JsonSchemaLike } from '../../lib/helpers/indexChat.helpers';
import type { IndexRow } from '../../model/indexesStore';

import type { IndexConfigToolsConfig, ToolFormFieldProps } from './IndexConfig';
import { IndexConfig } from './IndexConfig';
import type { IndexHistoryItem } from './IndexHistory';
import { IndexHistory } from './IndexHistory';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/ui/
 * IndexDetails/IndexViews.jsx` (unit A4a) — switches between the
 * Run/Configuration/History tab bodies.
 */
export interface IndexViewsProps {
  readonly activeView: string;
  readonly schema: JsonSchemaLike | null | undefined;
  readonly toolsConfig?: IndexConfigToolsConfig | null | undefined;
  readonly configInitialized: RefObject<boolean>;
  readonly initializeDefaultConfigValues: () => void;
  readonly toolInputVariables: Record<string, unknown>;
  readonly onChangeInputVariables: (value: Record<string, unknown>) => void;
  readonly isValidForm?: boolean | undefined;
  readonly changesDisabled?: boolean | undefined;
  readonly index: IndexRow | null | undefined;
  readonly isRunningTool?: boolean | undefined;
  readonly ToolFormField: ComponentType<ToolFormFieldProps>;
}

export function IndexViews(props: IndexViewsProps): ReactNode {
  const {
    activeView,
    schema,
    toolsConfig,
    configInitialized,
    initializeDefaultConfigValues,
    toolInputVariables,
    onChangeInputVariables,
    isValidForm,
    changesDisabled,
    index,
    isRunningTool,
    ToolFormField,
  } = props;

  const commonConfigProps = useMemo(
    () => ({
      schema,
      configInitialized,
      initializeDefaultConfigValues,
      toolInputVariables,
      onChangeInputVariables,
      changesDisabled,
      withNavigation: true,
      ToolFormField,
    }),
    [configInitialized, initializeDefaultConfigValues, onChangeInputVariables, schema, toolInputVariables, changesDisabled, ToolFormField],
  );

  if (activeView === EditViewTabsEnum.configuration) {
    return (
      <IndexConfig
        sx={{ '.index-config-field:first-of-type': { marginTop: 0 } }}
        {...commonConfigProps}
        changesDisabled
      />
    );
  }

  if (activeView === EditViewTabsEnum.history) {
    return <IndexHistory history={(index?.metadata['history'] as readonly IndexHistoryItem[] | undefined) ?? []} />;
  }

  return (
    <IndexConfig
      toolsConfig={toolsConfig}
      isValidForm={isValidForm}
      isRunningTool={isRunningTool}
      {...commonConfigProps}
    />
  );
}
