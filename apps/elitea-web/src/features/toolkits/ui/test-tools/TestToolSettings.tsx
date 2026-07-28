import type { ComponentType, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BaseBtn, BUTTON_VARIANTS } from '@/shared/ui/BaseBtn';
import { SingleSelect, type SingleSelectOption } from '@/shared/ui/SingleSelect';

import { IndexesToolsEnum } from '../../indexes/lib/constants/indexDetails.constants';
import type { JsonSchemaLike } from '../../indexes/lib/helpers/indexChat.helpers';
import type { UseIndexNameValidationResult } from '../../indexes/lib/hooks/useIndexNameValidation.hooks';
import type { ToolkitConversationValues } from '../../lib/helpers/toolkitConversation.helpers';
import { useGetCurrentToolkitSchemas } from '../../lib/hooks/useGetCurrentToolkitSchemas.hooks';
import type { LLMModelSelectorProps } from '../../indexes/ui/IndexDetails/IndexChat';
import type { ToolFormContainerProperty, ToolFormContainerSchema } from '../form/ToolFormContainer';
import { ToolFormContainer } from '../form/ToolFormContainer';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/test-tools/
 * TestToolSettings.jsx` (215 lines, Wave-2 unit A4f) — the right-hand
 * "pick a tool, fill its arguments, Run Tool" panel `TestTools.tsx` embeds.
 *
 * DISCLOSED DEVIATIONS, each forced by a real, verified constraint:
 *
 *  1. **No ambient Formik context.** `useFormikContext().values` becomes
 *     an explicit `values: ToolkitConversationValues` prop — this app has
 *     no Formik dependency (established convention, e.g. `DeleteApplicationButton.tsx`'s
 *     own doc comment).
 *
 *  2. **REAL BACKEND GAP: no `toolkit_available_tools` endpoint** (same gap
 *     `./useGetSelectedToolSchema.ts`'s own module doc comment discloses in
 *     full for its own, separate use of the identical missing endpoint —
 *     cited once there, not re-litigated here). The baseline's
 *     `shouldFetchDynamicTools`/`useToolkitAvailableToolsQuery`/
 *     `dynamicToolNames` three-step dance is dropped entirely:
 *     `allToolsOptions` falls back to `schemaToolNames` (the static
 *     `selected_tools` schema's `args_schemas` keys or `items.enum`)
 *     whenever there is no explicit `values.settings.selected_tools`
 *     selection. OpenAPI-type toolkits that expose ONLY a dynamic tool
 *     catalogue (no static schema, no explicit selection) will show an
 *     empty tool picker — a real, disclosed narrowing, not invented
 *     behaviour. `toolkitId`/`projectId` are dropped from this component's
 *     own prop list entirely (the baseline threads both purely to drive
 *     this now-gap-blocked query) rather than kept as accepted-but-unused
 *     props.
 *
 *  3. **`SHARED_TOUR_TARGET_IDS.testSettings` (`features/interactive-tours`)
 *     is dropped.** That domain does not exist in this worktree and is out
 *     of this Wave-2 batch's scope entirely (agents/pipelines/toolkits
 *     only) — same precedent `features/agents/ui/ApplicationTools.tsx`'s
 *     own doc comment already establishes for the identical class of gap:
 *     `data-tour` attributes are omitted rather than pointed at a feature
 *     that will never legally be importable here (`no-sideways-features`,
 *     no carve-out).
 *
 *  4. **`LLMModelSelector` is injected**, not rendered from a real import —
 *     `widgets/llm-model-selector` does not exist anywhere in this worktree
 *     (grepped) and `features/` cannot import `widgets/` even if it did
 *     (R-L1, upward-forbidden). Same DI treaty this slice's own
 *     `IndexChat.tsx` (unit A4a) already established for the identical
 *     baseline dependency — `LLMModelSelectorProps` is reused directly from
 *     that file (intra-slice, R-L3-legal) rather than re-declared, since
 *     the shape this component needs (`selectedModel`/`onSelectModel`/
 *     `models`/`llmSettings`/`onSetLLMSettings`) is byte-for-byte identical.
 *     The five LLM props are grouped into one `llm: LLMModelSelectorProps`
 *     prop (spread directly onto the injected component) rather than five
 *     separate top-level props.
 *
 *  5. **`ToolkitForm.ToolFormContainer` (baseline: `features/toolkits/ui/
 *     form/ToolkitForm/ToolkitForm.jsx`'s barrel) is NOT the component used
 *     here.** Per the mission brief, that is a DIFFERENT, unrelated
 *     component from `./ToolFormContainer.tsx` (A4d, ported from
 *     `pages/Applications/Components/Tools/ToolConfigurationForm.jsx`'s
 *     sibling `ui/form/ToolFormContainer.jsx` file — the old app's own
 *     `ui/index.js` barrel aliasing makes the two genuinely easy to
 *     confuse, per the mission preamble's own warning). `ToolFormContainer.tsx`'s
 *     own doc comment names `TestToolSettings.jsx` (this file) as one of
 *     its two real, intra-slice consumers. Its `onChangeInputVariables`
 *     is `(fieldKey, value) => void` (single-field), not the baseline's
 *     whole-object updater — `onFieldChange` below does the same
 *     caller-owns-the-merge adaptation `ToolFormContainer.tsx`'s own doc
 *     comment documents as the established convention.
 *
 *  6. **`SingleSelect` (unit S1-D) is a substantially trimmed port** of the
 *     baseline's `Select.SingleSelect` — no `withSearch`/`showEmptyPlaceholder`/
 *     `emptyPlaceholder`/`showBorder` (see `shared/ui/SingleSelect/
 *     SingleSelect.tsx`'s own doc comment for the full trim rationale).
 *     Same substitution `features/pipelines/ui/select/ToolSelect.tsx`
 *     (unit A2h) already made for an analogous "pick one tool from a list"
 *     picker. `SingleSelectOption.value` is `string`-only (unlike the
 *     baseline, which could hand a whole tool object through as `value`)
 *     — `allToolsOptions` below always resolves `value` to the same
 *     string used for `label` (the tool's name), never the raw object.
 *
 *  7. **`ContentContainer`** (`apps/elitea-ui/src/pages/Common/Components/
 *     StyledComponents.jsx`) is inlined as `contentContainerSx` rather than
 *     imported — its own base CSS (`boxSizing:'border-box'` plus, on `lg`+,
 *     a scrollable-but-hidden-native-scrollbar `overflowY`) is carried over
 *     alongside the baseline's `sx` overrides, not just the overrides
 *     themselves.
 *
 * Everything else — the `selectedToolsSchema`/`schemaToolNames` derivation,
 * the explicit-selection-first `allToolsOptions` priority, the
 * `onChangeInputVariablesWrapper`'s index-name-error side effect, the
 * disabled-run-tool condition, and the scrollable-fields-plus-sticky-
 * run-button layout — is a faithful, byte-for-byte port of this specific
 * file's own logic.
 */
export interface TestToolSettingsProps {
  readonly selectedTool: string | null;
  readonly onChangeTool: (value: string | null) => void;
  readonly toolInputVariables: Readonly<Record<string, unknown>>;
  readonly onChangeInputVariables: (value: Readonly<Record<string, unknown>>) => void;
  readonly onRunTool: () => void;
  readonly isRunning: boolean;
  readonly isValidForm: boolean;
  readonly selectedToolSchema: JsonSchemaLike | null | undefined;
  readonly values: ToolkitConversationValues;
  /** Grouped — see the module doc comment's DI-treaty item 4. */
  readonly llm: LLMModelSelectorProps;
  readonly LLMModelSelector: ComponentType<LLMModelSelectorProps>;
  /** Grouped — the four `useIndexNameValidation()` fields the baseline reads individually. */
  readonly indexNameValidation: UseIndexNameValidationResult;
}

interface SelectedToolsSchemaShape {
  readonly args_schemas?: Readonly<Record<string, unknown>> | undefined;
  readonly items?: { readonly enum?: readonly string[] | undefined } | undefined;
}

type ExplicitSelectedTool = string | { readonly name?: string | undefined };

function resolveToolName(tool: ExplicitSelectedTool): string {
  return typeof tool === 'string' ? tool : (tool.name ?? '');
}

function toToolOption(tool: ExplicitSelectedTool): SingleSelectOption {
  const name = resolveToolName(tool);
  const label = typeof tool === 'string' ? `${tool.charAt(0).toUpperCase()}${tool.slice(1)}`.replaceAll('_', ' ') : name;
  return { label, value: name };
}

export function TestToolSettings(props: TestToolSettingsProps): ReactNode {
  const { selectedTool, onChangeTool, toolInputVariables, onChangeInputVariables, onRunTool, isRunning, isValidForm, selectedToolSchema, values, llm, LLMModelSelector, indexNameValidation } = props;
  const { clearIndexNameError, updateIndexNameError, isIndexNameValid, indexNameError } = indexNameValidation;

  const { toolkitSchemas } = useGetCurrentToolkitSchemas();
  const selectedToolsSchema = values.type !== undefined ? (toolkitSchemas?.[values.type] as { properties?: { selected_tools?: SelectedToolsSchemaShape } } | undefined)?.properties?.selected_tools : undefined;
  const disabledRunTool = !isValidForm || isRunning || Boolean(indexNameError);

  const schemaToolNames = useMemo<readonly string[]>(() => {
    const argsSchemasKeys = Object.keys(selectedToolsSchema?.args_schemas ?? {});
    if (argsSchemasKeys.length) return argsSchemasKeys;
    return [...(selectedToolsSchema?.items?.enum ?? [])];
  }, [selectedToolsSchema]);

  const allToolsOptions = useMemo<SingleSelectOption[]>(() => {
    const explicitSelectedTools = (values.settings?.['selected_tools'] as readonly ExplicitSelectedTool[] | undefined) ?? [];
    const hasExplicitSelection = explicitSelectedTools.length > 0;
    // The baseline's third tier (`dynamicToolNames`) never resolves — see
    // the module doc comment's item 2 (no `toolkit_available_tools` endpoint).
    const availableTools = hasExplicitSelection ? explicitSelectedTools : schemaToolNames;

    return availableTools.map(toToolOption).sort((first, second) => first.label.toLowerCase().localeCompare(second.label.toLowerCase()));
  }, [schemaToolNames, values.settings]);

  const onChangeInputVariablesWrapper = useCallback(
    (value: Readonly<Record<string, unknown>>) => {
      const indexName = value['index_name'];
      const isInvalid = selectedTool === IndexesToolsEnum.indexData && typeof indexName === 'string' && indexName !== '' && !isIndexNameValid(indexName);

      if (isInvalid) updateIndexNameError(indexName);
      else clearIndexNameError();

      onChangeInputVariables(value);
    },
    [clearIndexNameError, isIndexNameValid, onChangeInputVariables, selectedTool, updateIndexNameError],
  );

  const onFieldChange = useCallback(
    (fieldKey: string, value: unknown) => {
      onChangeInputVariablesWrapper({ ...toolInputVariables, [fieldKey]: value });
    },
    [onChangeInputVariablesWrapper, toolInputVariables],
  );

  const onClearTool = useCallback(() => onChangeTool(null), [onChangeTool]);
  const onSelectTool = useCallback((value: string) => onChangeTool(value), [onChangeTool]);

  return (
    <Box sx={rootSx}>
      <Box sx={contentContainerSx}>
        <Box>
          <Typography variant="subtitle">{t('features.toolkits.testToolSettings.title', 'Test Settings')}</Typography>
        </Box>
        <Box sx={llmModelContainerSx}>
          <LLMModelSelector {...llm} />
        </Box>
        <Box sx={toolSelectContainerSx}>
          <SingleSelect
            value={selectedTool ?? ''}
            label={t('features.toolkits.testToolSettings.toolLabel', 'Tool')}
            onChange={onSelectTool}
            onClear={onClearTool}
            options={allToolsOptions}
          />
        </Box>

        {selectedTool && (
          <Box sx={configContainerSx}>
            <Box sx={scrollableSectionSx}>
              {Object.keys(selectedToolSchema?.properties ?? {}).map((key) => (
                <ToolFormContainer
                  key={key}
                  fieldKey={key}
                  property={selectedToolSchema?.properties?.[key] as ToolFormContainerProperty}
                  toolInputVariables={toolInputVariables}
                  schema={selectedToolSchema as ToolFormContainerSchema | undefined}
                  onChangeInputVariables={onFieldChange}
                />
              ))}
            </Box>

            <Box sx={runToolBtnSx}>
              <BaseBtn
                variant={BUTTON_VARIANTS.special}
                fullWidth
                disabled={disabledRunTool}
                onClick={onRunTool}
                startIcon={<PlayArrowIcon />}
              >
                {t('features.toolkits.testToolSettings.runTool', 'RUN TOOL')}
              </BaseBtn>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

const rootSx: SxProps<Theme> = { width: '100%', height: '100%' };

// Baseline: `<ContentContainer sx={styles.contentContainer}>`
// (`apps/elitea-ui/src/pages/Common/Components/StyledComponents.jsx`) — the
// styled component's own base CSS (`boxSizing:'border-box'` plus, on `lg`+,
// a scrollable-but-scrollbar-hidden `overflowY`) is restored here alongside
// the baseline's `sx` overrides (`height`/`maxHeight`/`display`/
// `flexDirection`/`justifyContent`) rather than left dropped.
export const contentContainerSx: SxProps<Theme> = ({ breakpoints }) => ({
  height: '100%',
  maxHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  boxSizing: 'border-box',
  [breakpoints.up('lg')]: {
    overflowY: 'scroll',
    msOverflowStyle: 'none',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
  },
});

const llmModelContainerSx: SxProps<Theme> = {
  flexShrink: 0,
  width: '100%',
  overflow: 'hidden',
  marginTop: '.875rem',
};

const toolSelectContainerSx: SxProps<Theme> = {
  marginTop: '0.5rem',
  paddingRight: '0.5rem',
};

const configContainerSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: '25rem',
};

const scrollableSectionSx: SxProps<Theme> = ({ palette, vars }) => ({
  flex: 1,
  overflowY: 'auto',
  overflowX: 'hidden',
  paddingRight: '.5rem',
  marginRight: '-.5rem',
  '&::-webkit-scrollbar': { width: '.375rem' },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': { background: palette.divider, borderRadius: vars.shape.radiusSm },
  '&::-webkit-scrollbar-thumb:hover': { background: palette.action.hover },
});

const runToolBtnSx: SxProps<Theme> = ({ palette }) => ({
  marginTop: '1rem',
  paddingRight: '0.5rem',
  paddingTop: '1rem',
  borderTop: `.0625rem solid ${palette.divider}`,
  position: 'sticky',
  bottom: 0,
  zIndex: 1,
});
