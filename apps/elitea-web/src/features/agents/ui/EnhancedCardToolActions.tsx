import type { MouseEvent, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
// `@mui/icons-material@9.2.0` ships no bare `ErrorOutline.js` (only the
// `*Outlined`/`*Rounded`/`*Sharp`/`*TwoTone` style-suffixed files, and a
// separately-named `ErrorOutlined` — verified against `node_modules/
// @mui/icons-material/` directly). `ErrorOutlineOutlined` is the closest
// same-glyph match.
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { handleCopy } from '@/shared/lib/clipboard';
import { TypographyWithConditionalTooltip } from '@/shared/ui/TypographyWithConditionalTooltip';

import type { AgentToolAvailableToolOption } from '../lib/types';

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/Components/Tools/CardActions/EnhancedCardToolActions.jsx`
 * (`EnhancedCardToolActions` + its co-located `ToolView`/`UnavailableToolView`
 * row components, folded in below as private, non-exported components).
 *
 * DEVIATION (form write): the baseline calls `useFormikContext().setFieldValue`
 * directly. This app uses react-hook-form (spec §2.3), but more to the
 * point, per this batch's layering rule this cluster does not carry any
 * ambient form context at all — `onSelectedToolsChange` replaces the
 * baseline's inline `setFieldValue(...)` call with a plain callback prop
 * carrying the same computed payload (the toggle add/remove diffing itself
 * stays right here, faithfully ported — only the actual form WRITE moved),
 * same "caller-computed" shape this codebase already uses consistently for
 * every write this cluster used to perform via an owning hook (see
 * `ToolCard.tsx`'s own header comment for the full rationale).
 *
 * DEVIATION (toast): the baseline's `ToolView` calls `useToast().toastInfo(...)`
 * after copying a tool name to the clipboard. No toast primitive exists yet
 * in `shared/ui` (same gap `features/mcps/model/useMcpAuthModal.ts` already
 * documents) — `onToolCopied?: () => void` lets a caller surface it once one
 * does.
 *
 * DEVIATION (icon): the baseline's copy-button icon is
 * `@/components/Icons/CopyIcon` (a custom SVG), not part of S2's ported
 * `shared/ui/icons/` set (no `copy-icon.tsx`; the only copy-shaped icon
 * there is `copy-link-icon.tsx`, a different glyph). `ContentCopy` from
 * `@mui/icons-material` is used as the interim substitute — same class of
 * gap `shared/ui/ControlsDropdown`'s own `MoreVertIcon` TODO documents.
 *
 * `ChipWithCheckIcon` (`@/components/ChipWithCheckIcon`) is folded in as a
 * private `UnavailableChip` — not part of `shared/ui` and used by other
 * baseline call sites this sub-unit does not own, so duplicated locally per
 * this batch's "port it yourself" directive rather than promoted. Its
 * `& .MuiChip-icon` colour override is dropped (R-T6 bans
 * `.Mui<Component>-<slot>` selectors outside `shared/brand/mui-overrides/`)
 * — MUI's `Chip` already colours its `icon` slot from the chip's own text
 * colour by default, so this is a real but minor, disclosed fidelity
 * reduction, not a functional change. Baseline's call site always passes an
 * explicit `icon={<ErrorOutlineIcon .../>}`, which wins over
 * `ChipWithCheckIcon`'s own internal `isSelected`-checkmark fallback (dead
 * code at that call site) — `UnavailableChip` here matches that: the warning
 * icon renders unconditionally, regardless of selection state.
 */
export interface EnhancedCardToolActionsProps {
  readonly toolOptions?: readonly AgentToolAvailableToolOption[] | undefined;
  readonly selectedTools?: readonly string[] | undefined;
  readonly availableTools?: readonly string[] | undefined;
  readonly showActions?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** The FULL resulting `selected_tools` array after one tool was toggled — same payload shape the baseline wrote via `setFieldValue('version_details.tools.${index}.settings.selected_tools', newSelectedTools)`; only the write mechanism (a callback instead of a direct form write) moved. */
  readonly onSelectedToolsChange: (newSelectedTools: readonly string[]) => void;
  readonly onToolCopied?: (() => void) | undefined;
}

interface NormalizedToolOption {
  readonly label: string;
  readonly value: string;
}

function normalizeToolOptions(options: readonly AgentToolAvailableToolOption[]): readonly NormalizedToolOption[] {
  return options
    .map((item): NormalizedToolOption | null => {
      const name = item.value ?? item.name ?? item.label;
      if (typeof name !== 'string' || !name.trim()) return null;
      const label = item.label ?? `${name.charAt(0).toUpperCase()}${name.slice(1)}`.replaceAll('_', ' ');
      return { label, value: name };
    })
    .filter((item): item is NormalizedToolOption => item !== null);
}

function ToolView({ toolOption, isSelected, onToggle, onCopied }: { readonly toolOption: NormalizedToolOption; readonly isSelected: boolean; readonly onToggle: () => void; readonly onCopied?: (() => void) | undefined }): ReactNode {
  const [isHovering, setIsHovering] = useState(false);

  const onCopy = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      void handleCopy(toolOption.value).then(() => onCopied?.());
    },
    [toolOption.value, onCopied],
  );

  return (
    <Box
      sx={toolContainerSx(isSelected)}
      onClick={onToggle}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {isSelected && <CheckIcon sx={checkIconSx} />}
      <TypographyWithConditionalTooltip
        title={toolOption.label}
        placement="top"
        variant="bodyMedium"
        color="text.secondary"
        sx={toolLabelSx}
      >
        {toolOption.label}
      </TypographyWithConditionalTooltip>
      {isHovering && (
        <Box sx={copyButtonContainerSx}>
          <Tooltip
            title={t('agents.enhancedCardToolActions.copyTooltip', 'Copy the tool name')}
            placement="top"
          >
            <IconButton
              sx={copyActionButtonSx}
              color="tertiary"
              onClick={onCopy}
            >
              <ContentCopyIcon sx={copyActionIconSx} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}

function UnavailableChip({ toolOption, onClick }: { readonly toolOption: NormalizedToolOption; readonly onClick?: (() => void) | undefined }): ReactNode {
  return (
    <Tooltip
      title={t('agents.enhancedCardToolActions.unavailableTooltip', 'Tool is not available')}
      placement="top"
    >
      <span>
        <Chip
          clickable={!!onClick}
          onClick={onClick}
          icon={<ErrorOutlineIcon fontSize="small" color="warning" />}
          label={toolOption.label}
          sx={unavailableChipSx(!onClick)}
        />
      </span>
    </Tooltip>
  );
}

export function EnhancedCardToolActions({
  toolOptions = [],
  selectedTools = [],
  availableTools = [],
  showActions = false,
  disabled,
  onSelectedToolsChange,
  onToolCopied,
}: EnhancedCardToolActionsProps): ReactNode {
  const sortedTools = useMemo(() => {
    const normalized = normalizeToolOptions(toolOptions);
    const selectedSet = new Set(selectedTools);
    const selected = normalized.filter((item) => selectedSet.has(item.value));
    const unselected = normalized.filter((item) => !selectedSet.has(item.value));
    const byLabel = (a: NormalizedToolOption, b: NormalizedToolOption) => a.label.localeCompare(b.label);
    return [...selected.sort(byLabel), ...unselected.sort(byLabel)];
  }, [selectedTools, toolOptions]);

  const handleToggle = useCallback(
    (toolValue: string) => {
      if (disabled) return;
      const next = selectedTools.includes(toolValue) ? selectedTools.filter((item) => item !== toolValue) : [...selectedTools, toolValue];
      onSelectedToolsChange(next);
    },
    [disabled, onSelectedToolsChange, selectedTools],
  );

  if (!showActions) return null;

  return (
    <Box sx={actionsContainerSx}>
      <Box sx={dividerLineSx} />
      <Box sx={toolsWrapperSx}>
        {sortedTools.map((toolOption) => {
          const isSelected = selectedTools.includes(toolOption.value);
          const isAvailable = !availableTools.length || availableTools.includes(toolOption.value);
          const toggle = () => handleToggle(toolOption.value);

          return isAvailable ? (
            <ToolView
              key={toolOption.value}
              toolOption={toolOption}
              isSelected={isSelected}
              onToggle={toggle}
              onCopied={onToolCopied}
            />
          ) : (
            <UnavailableChip
              key={toolOption.value}
              toolOption={toolOption}
              onClick={isSelected ? toggle : undefined}
            />
          );
        })}
      </Box>
    </Box>
  );
}

const actionsContainerSx: SxProps<Theme> = { mt: 0, padding: '0rem 0.5rem 0.5rem 0.5rem' };

const dividerLineSx: SxProps<Theme> = (theme: Theme) => ({
  width: '100%',
  height: '0.0625rem',
  background: theme.vars.palette.border.lines,
  marginBottom: theme.spacing(2),
});

const toolsWrapperSx: SxProps<Theme> = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  alignContent: 'flex-start',
  padding: '0.25rem 1rem',
  gap: '0.5rem',
  width: '100%',
};

const toolContainerSx = (isSelected: boolean): SxProps<Theme> => (theme: Theme) => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  padding: '0.25rem 1rem',
  boxSizing: 'border-box',
  gap: '0.5rem',
  height: '2rem',
  background: isSelected ? theme.vars.palette.background.select.selected.default : theme.vars.palette.background.button.secondary.default,
  borderRadius: theme.vars.shape.radiusMd,
  cursor: 'pointer',
  transition: 'background-color 0.2s ease, padding-right 0.2s ease',
  maxWidth: '100%',
  overflow: 'hidden',
  '&:hover': {
    background: isSelected ? theme.vars.palette.background.select.selected.hover : theme.vars.palette.background.button.secondary.hover,
  },
});

const checkIconSx: SxProps<Theme> = (theme: Theme) => ({
  width: '1rem',
  height: '1rem',
  color: theme.vars.palette.text.secondary,
  flexShrink: 0,
});

const toolLabelSx: SxProps<Theme> = { maxWidth: 'calc(100% - 1.25rem)' };

const copyButtonContainerSx: SxProps<Theme> = {
  position: 'absolute',
  right: '0.5rem',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 1,
};

const copyActionButtonSx: SxProps<Theme> = { width: '1.75rem', height: '1.75rem', padding: '0.125rem' };
const copyActionIconSx: SxProps<Theme> = { width: '1rem', height: '1rem' };

const unavailableChipSx = (disabled: boolean): SxProps<Theme> => (theme: Theme) => ({
  gap: '0.5rem',
  borderRadius: theme.vars.shape.radiusMd,
  color: !disabled ? theme.vars.palette.text.secondary : theme.vars.palette.text.disabled,
  background: theme.vars.palette.background.warningBkg,
  border: `0.0625rem solid ${theme.vars.palette.warning.main}`,
});
