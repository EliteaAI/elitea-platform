import type { ChangeEvent, ReactNode } from 'react';
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import type { SxProps, Theme } from '@mui/material/styles';

import { PERMISSIONS } from '@/shared/lib/permissions';
import { BaseSwitch } from '@/shared/ui/BaseSwitch';
import { InfoTooltip } from '@/shared/ui/InfoTooltip';

import { INTERNAL_TOOLS_LIST } from '../lib/internalTools';
import { useHasPermission } from '../lib/useHasPermission';
import { useSelectedProjectId } from '../api/useSelectedProjectId';

const ATTACHMENTS_TOOL_DESCRIPTOR = INTERNAL_TOOLS_LIST.find((tool) => tool.name === 'attachments');
const ATTACHMENTS_TOOL_TITLE = ATTACHMENTS_TOOL_DESCRIPTOR?.title ?? 'Attachments';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/
 * configurations/switch/AttachmentSwitch.jsx`.
 *
 * Toggles `'attachments'` membership in `version_details.meta.internal_tools`
 * — same array the `AgentInternalToolSwitch` for the `attachments`
 * `INTERNAL_TOOLS_LIST` entry manages; this is a SEPARATE, standalone switch
 * (used outside the internal-tools grid, per the baseline's own separate
 * file) with its own permission gate and pipeline-sync side effect.
 *
 * DISCLOSED REDESIGN (two parts, both real constraints, not simplifications
 * of convenience):
 *
 * 1. **No ambient form context.** `checked`/`onCheckedChange` are explicit
 *    props, same convention as every other switch in this sub-unit — the
 *    caller owns `version_details.meta.internal_tools`.
 *
 * 2. **Pipeline-YAML sync is injected, not hard-wired.** The baseline reads
 *    `useSelector(state => state.pipeline)` and dispatches
 *    `pipelineActions.setYamlCode`/`setYamlJsonObject` directly, to keep a
 *    pipeline's `state.input_attachments` YAML key in sync with this switch.
 *    Redux does not exist in this app (§2.3), and even if it did,
 *    `features/pipelines`' YAML/flow-editor state is a DIFFERENT `features/`
 *    slice — `no-sideways-features` forbids reaching into it regardless. The
 *    optional `onAttachmentsChange` callback fires AFTER this switch's own
 *    `internal_tools` write, with the new checked state — a future pipelines
 *    caller supplies it to run its own YAML sync; the agents-domain default
 *    caller simply omits it (agents have no pipeline YAML to sync).
 *
 * Permission gate: uses this worktree's real `useHasPermission` (`../lib/
 * useHasPermission.ts`, landed sibling infra) against
 * `PERMISSIONS.toolkits.patch` — the same permission string the baseline's
 * `checkPermission(PERMISSIONS.toolkits.patch)` checks
 * (`common/constants.js:521-616` -> `shared/lib/permissions.ts`, unit S3).
 */
export interface AttachmentSwitchProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean | undefined;
  /** Fires after this switch's own state write — see the module doc comment's part 2. */
  readonly onAttachmentsChange?: ((checked: boolean) => void) | undefined;
}

export function AttachmentSwitch({ checked, onCheckedChange, disabled, onAttachmentsChange }: AttachmentSwitchProps): ReactNode {
  const projectId = useSelectedProjectId();
  const hasPatchPermission = useHasPermission(projectId, PERMISSIONS.toolkits.patch);
  const disabledSwitch = !hasPatchPermission || disabled;

  const onChange = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checkedValue: boolean) => {
      onCheckedChange(checkedValue);
      onAttachmentsChange?.(checkedValue);
    },
    [onCheckedChange, onAttachmentsChange],
  );

  return (
    <FormControlLabel
      labelPlacement="end"
      control={
        <BaseSwitch
          checked={checked}
          onChange={onChange}
          disabled={disabledSwitch}
        />
      }
      label={
        <Box sx={labelSx}>
          {ATTACHMENTS_TOOL_TITLE}
          {ATTACHMENTS_TOOL_DESCRIPTOR?.infoTooltip && (
            <InfoTooltip title={ATTACHMENTS_TOOL_DESCRIPTOR.infoTooltip.text} />
          )}
        </Box>
      }
    />
  );
}

const labelSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
};
