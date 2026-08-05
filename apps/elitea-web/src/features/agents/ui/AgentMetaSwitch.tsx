import type { ChangeEvent, ReactNode } from 'react';
import { useCallback } from 'react';

import FormControlLabel from '@mui/material/FormControlLabel';

import { BaseSwitch } from '@/shared/ui/BaseSwitch';
import { InfoTooltip } from '@/shared/ui/InfoTooltip';
import { TextWithLink } from '@/shared/ui/TextWithLink';

import type { InternalToolInfoTooltip } from '../lib/internalTools';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/
 * configurations/switch/AgentMetaSwitch.jsx` — a toggle for an arbitrary
 * boolean `version_details.meta[metaKey]` flag (distinct from
 * `AgentInternalToolSwitch`, which manages array membership).
 *
 * DISCLOSED REDESIGN, same shape as `AgentInternalToolSwitch.tsx`: no
 * ambient form context — `checked`/`onCheckedChange` are explicit props,
 * the caller resolves and writes back `version_details.meta[metaKey]`
 * itself (this component no longer needs to know the key at all, since it
 * no longer reads/writes the form directly).
 *
 * The baseline's `Switch.BaseSwitch` had baked-in `label`/`infoTooltip`/
 * `width`/`slotProps.formControlLabel` props; this app's `BaseSwitch`
 * (`shared/ui/BaseSwitch.tsx`) is a thin, chrome-free `MuiSwitch` wrapper by
 * design (its own doc comment: "that chrome is a composition concern for a
 * caller"). Composed here via `FormControlLabel` + `InfoTooltip`, the exact
 * same composition `AgentInternalToolSwitch.tsx` (this sub-unit's own
 * sibling file) already establishes for the identical "switch with a
 * trailing info tooltip" shape.
 */
export interface AgentMetaSwitchProps {
  readonly title: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean | undefined;
  readonly infoTooltip?: InternalToolInfoTooltip | undefined;
}

export function AgentMetaSwitch({ title, checked, onCheckedChange, disabled, infoTooltip }: AgentMetaSwitchProps): ReactNode {
  const onChange = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checkedValue: boolean) => {
      onCheckedChange(checkedValue);
    },
    [onCheckedChange],
  );

  return (
    <FormControlLabel
      labelPlacement="end"
      control={
        <BaseSwitch
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
      }
      label={
        <>
          {title}
          {infoTooltip && (
            <InfoTooltip
              title={
                infoTooltip.linkUrl && infoTooltip.linkText ? (
                  <TextWithLink
                    text={infoTooltip.text}
                    linkUrl={infoTooltip.linkUrl}
                    linkText={infoTooltip.linkText}
                    suffix={infoTooltip.suffix}
                  />
                ) : (
                  infoTooltip.text
                )
              }
            />
          )}
        </>
      }
    />
  );
}
