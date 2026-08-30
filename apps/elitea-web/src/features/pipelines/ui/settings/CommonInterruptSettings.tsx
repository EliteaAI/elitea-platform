import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseSwitch } from '@/shared/ui/BaseSwitch';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { FlowEditorContext, type FlowEditorContextValue } from '../../lib/flow-editor/flowEditorContext';
import * as FlowEditorHelpers from '../../lib/flow-editor/helpers/flowEditor.helpers';
import type { YamlPipelineDocument, YamlPipelineNode } from '../../lib/flow-editor/helpers/pipelineFlow.types';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/CommonInterruptSettings.jsx` (unit A2h). Reads `FlowEditorContext`
 * from `../../lib/flow-editor/flowEditorContext.ts` (see `InputSelect.tsx`'s
 * doc comment for the R-L1 rationale).
 *
 * `styled(FormControlLabel)` (baseline: `@emotion/styled`) -> a plain `sx`
 * object -- this app's `shared/ui` components consistently use MUI's `sx`
 * prop rather than `@emotion/styled` wrappers for one-off styling.
 *
 * ── The two interrupt switches are permanently disabled. This is a
 * deliberate INTERSECTION choice, not an oversight. ───────────────────────
 *
 * A pipeline turn can be executed by either of two workers, and the editor
 * cannot know which one will take a given turn:
 *
 *  - the **native Rust runtime** refuses ANY non-empty `interrupt_before` /
 *    `interrupt_after` outright — `services/elitea-worker-rust/src/agents/
 *    graph/compiler.rs:470-474`, "static pipeline interrupts are not enabled
 *    in this compiler slice". The refusal is whole-document: one interrupt
 *    entry and the pipeline does not start at all.
 *  - the **Python SDK worker** honours them.
 *
 * So the editor authors the intersection both accept: no static interrupts.
 * Before this change, flipping either switch silently turned a working
 * pipeline into one that would not start, with no signal anywhere in the
 * UI until a chat turn failed in another process with a data-free
 * `graph.pipeline.invalid_configuration`.
 *
 * The switches are DISABLED rather than removed on purpose. Removing them
 * would hide the fact that this capability exists and is withheld, and it
 * would leave a document that already carries interrupts (authored before
 * this change, or through the YAML tab) showing nothing at all. Kept
 * disabled, they still display the stored state, and
 * `lib/graphAdmission.helpers.ts`'s `document.static-interrupts` rule names
 * the exact entries in the save gate — the YAML tab is the repair path for
 * such a document.
 *
 * **To re-enable them**, exactly one thing has to change: the Rust
 * compiler has to admit static interrupts (`compiler.rs:470-474` becomes a
 * real `interrupt_before`/`interrupt_after` wiring rather than an
 * `Unsupported` early return, and `MAX_STATIC_INTERRUPTS` at
 * `compiler.rs:53` stops being decorative). When that lands, drop the
 * hardcoded `disabled` on the two `InterruptSwitchRow`s below (restoring
 * `isEntryPoint || disabled` / `isEndTransition || disabled`), restore the two `useCallback` toggle
 * handlers this file used to carry (they wrote `{...yamlJsonObject,
 * [field]: nextList}` and relabelled the incoming/outgoing edge via
 * `setFlowEdges`), and drop the `document.static-interrupts` rule.
 */

export interface CommonInterruptSettingsProps {
  readonly id: string;
  readonly showStructuredOutput?: boolean;
  readonly type?: string;
  readonly disabled?: boolean | undefined;
}

const rowSx: SxProps<Theme> = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', width: '100%', flexDirection: 'row' };
const reasonSx: SxProps<Theme> = { width: '100%' };

function switchLabelSx(theme: Theme) {
  return {
    width: '13.375rem',
    height: '2rem',
    borderRadius: theme.vars.shape.radiusMd,
    marginLeft: '0rem',
    marginRight: '0rem',
    padding: '0.25rem 0.5rem',
    justifyContent: 'flex-start',
    gap: '0.5rem',
    background: theme.vars.palette.background.userInputBackground,
  };
}

interface InterruptSwitchRowProps {
  readonly disabled: boolean;
  readonly checked: boolean;
  readonly onChange?: ((event: ChangeEvent<HTMLInputElement>) => void) | undefined;
  readonly label: ReactNode;
  readonly emphasized: boolean;
}

function InterruptSwitchRow({ disabled, checked, onChange, label, emphasized }: InterruptSwitchRowProps): ReactNode {
  return (
    <FormControlLabel
      sx={switchLabelSx}
      control={
        <BaseSwitch
          disabled={disabled}
          checked={checked}
          onChange={onChange}
        />
      }
      label={
        <Typography
          variant="labelSmall"
          color={emphasized ? 'text.primary' : 'text.secondary'}
        >
          {label}
        </Typography>
      }
      labelPlacement="end"
    />
  );
}

interface InterruptSettingsContext {
  readonly yamlJsonObject: YamlPipelineDocument | undefined;
  readonly setYamlJsonObject: FlowEditorContextValue['setYamlJsonObject'] | undefined;
  readonly yamlNode: YamlPipelineNode | undefined;
  readonly isEntryPoint: boolean;
  readonly isEndTransition: boolean;
  readonly realInterruptBefore: readonly string[];
  readonly realInterruptAfter: readonly string[];
}

/**
 * Baseline's `Array.isArray(yamlJsonObject?.interrupt_before) ?
 * yamlJsonObject?.interrupt_before : []` (`CommonInterruptSettings.jsx:27-34`)
 * -- a malformed (non-array) `interrupt_before`/`interrupt_after` value in
 * the YAML degrades to an empty list instead of flowing into `.includes()`.
 *
 * The explicitly-typed intermediate `list: readonly string[]` binding is
 * required, not stylistic: `Array.isArray`'s `arg is any[]` predicate widens
 * the narrowed value to `any[]`, tripping `no-unsafe-return` on a direct or
 * unannotated return -- the same gap `parsePipelineTraversal.helpers.ts:138-139`
 * and `yamlUpdate.helpers.ts` already document for this exact pattern.
 */
function toInterruptList(value: readonly string[] | undefined): readonly string[] {
  const list: readonly string[] = Array.isArray(value) ? value : [];
  return list;
}

/** Every `FlowEditorContext` read plus derived entry-point/end-transition flags for this node. */
function useInterruptSettingsContext(id: string, type: string | undefined): InterruptSettingsContext {
  const context = useContext(FlowEditorContext);
  const yamlJsonObject = context?.yamlJsonObject;

  const yamlNode = useMemo(() => yamlJsonObject?.nodes?.find((node) => matchesNode(node, id, type)), [id, type, yamlJsonObject]);

  return {
    yamlJsonObject,
    setYamlJsonObject: context?.setYamlJsonObject,
    yamlNode,
    isEntryPoint: yamlJsonObject?.entry_point === id,
    isEndTransition: yamlNode?.transition === FlowEditorConstants.PipelineNodeTypes.End,
    realInterruptBefore: toInterruptList(yamlJsonObject?.interrupt_before),
    realInterruptAfter: toInterruptList(yamlJsonObject?.interrupt_after),
  };
}

function matchesNode(node: YamlPipelineNode, id: string, type: string | undefined): boolean {
  return node.id === id && node.type === type;
}

export function CommonInterruptSettings(props: CommonInterruptSettingsProps): ReactNode {
  const { id, showStructuredOutput = true, type, disabled = false } = props;

  const { yamlJsonObject, setYamlJsonObject, yamlNode, isEntryPoint, isEndTransition, realInterruptBefore, realInterruptAfter } = useInterruptSettingsContext(id, type);

  const onChangeStructuredOutput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!setYamlJsonObject) return;
      FlowEditorHelpers.updateYamlNode(id, 'structured_output', event.target.checked, yamlJsonObject, setYamlJsonObject);
    },
    [yamlJsonObject, setYamlJsonObject, id],
  );

  return (
    <Box sx={rowSx}>
      <InterruptSwitchRow
        disabled
        checked={!isEntryPoint && realInterruptBefore.includes(id)}
        label={t('pipelines.commonInterruptSettings.interruptBefore', 'Interrupt before')}
        emphasized={isEntryPoint}
      />
      <InterruptSwitchRow
        disabled
        checked={!isEndTransition && realInterruptAfter.includes(id)}
        label={t('pipelines.commonInterruptSettings.interruptAfter', 'Interrupt after')}
        emphasized={isEndTransition}
      />
      <Typography
        variant="bodySmall"
        color="text.secondary"
        sx={reasonSx}
        data-testid="interrupt-withheld-reason"
      >
        {t(
          'pipelines.commonInterruptSettings.withheldReason',
          'Interrupts are unavailable: the native pipeline runtime refuses any pipeline that declares them, so a pipeline saved with one would not start.',
        )}
      </Typography>
      {showStructuredOutput && (
        <InterruptSwitchRow
          disabled={disabled}
          checked={Boolean(yamlNode?.structured_output)}
          onChange={onChangeStructuredOutput}
          label={t('pipelines.commonInterruptSettings.structuredOutput', 'Structured output')}
          emphasized={false}
        />
      )}
    </Box>
  );
}
