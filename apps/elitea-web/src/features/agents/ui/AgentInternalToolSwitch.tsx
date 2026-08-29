import type { ChangeEvent, ReactNode } from 'react';
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { BaseSwitch } from '@/shared/ui/BaseSwitch';
import { InfoTooltip } from '@/shared/ui/InfoTooltip';
import { TextWithLink } from '@/shared/ui/TextWithLink';

import type { InternalToolInfoTooltip } from '../lib/internalTools';
import { INTERNAL_TOOL_ICONS } from '../lib/internalTools';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/
 * configurations/switch/AgentInternalToolSwitch.jsx`.
 *
 * DISCLOSED REDESIGN — no ambient form context (see `../model/types.ts`'s
 * module doc comment): `checked`/`onCheckedChange` are explicit props
 * instead of reading/writing `version_details.meta.internal_tools` via
 * `useFormikContext()`; the caller (`ApplicationTools.tsx`) owns the array
 * membership computation and passes `checked` down per-instance.
 *
 * `EntityIcon` (`components/EntityIcon.jsx`, baseline) has no `shared/ui`
 * port and no confirmed home in this sub-unit's owned files — used across
 * 20 baseline call sites spanning multiple domains, so it belongs in
 * `shared/ui` once promoted, not duplicated here. This port renders the
 * resolved tool icon (`INTERNAL_TOOL_ICONS[icon]`, see `../lib/
 * internalTools.ts`) directly instead of routing through `EntityIcon`'s
 * `editable={false}` read-only path — the baseline's own read-only branch
 * of `EntityIcon` is exactly "render this icon in a small rounded box",
 * reproduced directly below with no loss of behaviour for this
 * non-editable call site.
 */
export interface AgentInternalToolSwitchProps {
  readonly title: string;
  readonly icon: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean | undefined;
  readonly infoTooltip?: InternalToolInfoTooltip | undefined;
}

export function AgentInternalToolSwitch({
  title,
  icon,
  checked,
  onCheckedChange,
  disabled,
  infoTooltip,
}: AgentInternalToolSwitchProps): ReactNode {
  const onChange = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checkedValue: boolean) => {
      onCheckedChange(checkedValue);
    },
    [onCheckedChange],
  );

  const ToolIcon = INTERNAL_TOOL_ICONS[icon];

  return (
    // The testid is keyed by the DISPLAY title because that is the only
    // identity this component receives — the canonical tool name stays with
    // the caller. Journeys address one switch among eight with it; the rows
    // are otherwise unnamed in the accessibility tree (the FormControlLabel's
    // label is empty).
    <Box
      sx={containerSx}
      data-testid={`internal-tool-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <Box sx={contentContainerSx}>
        {ToolIcon && (
          <Box sx={entityIconSx}>
            <ToolIcon width="0.875rem" height="0.875rem" />
          </Box>
        )}
        <Typography
          variant="bodyMedium"
          color="text.secondary"
          sx={titleSx}
        >
          {title}
        </Typography>
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
      </Box>
      <FormControlLabel
        control={
          <BaseSwitch
            checked={checked}
            onChange={onChange}
            disabled={disabled}
          />
        }
        label=""
        sx={switchLabelSx}
      />
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  backgroundColor: theme.vars.palette.background.userInputBackground,
  borderRadius: theme.vars.shape.radiusMd,
  height: '2.5rem',
  padding: '0.75rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  width: '100%',
});

const contentContainerSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  flex: 1,
  minWidth: 0,
};

const titleSx: SxProps<Theme> = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const entityIconSx: SxProps<Theme> = (theme: Theme) => ({
  minWidth: '1.5rem',
  width: '1.5rem',
  height: '1.5rem',
  marginRight: '0.5rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.vars.palette.secondary.main,
});

const switchLabelSx: SxProps<Theme> = {
  margin: 0,
  padding: 0,
};
