import type { ReactNode } from 'react';

// `@mui/icons-material` in this app's installed version has no plain
// `ErrorOutline` export (verified: `ls node_modules/@mui/icons-material |
// grep -i ^error` — only style-suffixed variants exist, e.g.
// `EnhancedCardToolActions.tsx`'s own identical substitution note).
// `ErrorOutlineOutlined` is the closest visual match to the baseline's
// `ErrorOutlineIcon` (an outlined circle-exclamation glyph).
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';

import { ChipWithCheckIcon } from './ChipWithCheckIcon';

/** One selectable tool chip option, `{value, label}` — matches `ToolActionsSelector.tsx`'s own `toolsOptions`. */
export interface ToolActionOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/
 * ToolBase/ToolActionsItems.jsx` (71 lines) — the chip row of selectable
 * tool actions, plus a leading row of "warning" chips for
 * previously-selected tools no longer present in the schema.
 *
 * DISCLOSED SIMPLIFICATION: the baseline's warning-chip branch also handled
 * a legacy OpenAPI toolkit shape where a "tool" could be a raw
 * `{name, path, method, description}` object rather than a string — flagged
 * in the baseline itself as `TODO: DELETE type check after migration period
 * (Q1 2026)`. `warningTools` here is typed `readonly string[]`
 * (`ToolActionsSelector.tsx`'s own `selectedTools`/`availableTools` are
 * already string arrays in this port — see that file's own doc comment for
 * why the object-shaped legacy case does not arise here), so that dead
 * branch is dropped rather than ported.
 *
 * `Tooltip` uses plain `@mui/material/Tooltip` directly, not the baseline's
 * `@/ComponentsLib/Tooltip` (`StyledTooltip`) — that wrapper's only real
 * customization, an `extraStyles` prop, is never passed at this call site,
 * so it is behaviourally identical to bare MUI `Tooltip` here.
 */
export interface ToolActionsItemsProps {
  readonly toolsOptions: readonly ToolActionOption[];
  readonly warningTools: readonly string[];
  readonly selectedTools: readonly string[];
  readonly onSelectTool: (value: string) => () => void;
  readonly disabled: boolean | undefined;
  readonly sx?: { readonly stack?: SxProps<Theme>; readonly chip?: SxProps<Theme> };
}

export function ToolActionsItems({
  toolsOptions,
  warningTools,
  selectedTools,
  onSelectTool,
  disabled,
  sx,
}: ToolActionsItemsProps): ReactNode {
  return (
    <Stack
      sx={sx?.stack ?? stackSx}
      useFlexGap
      direction="row"
      spacing={1}
    >
      {warningTools.map((tool) => (
        <Tooltip
          key={tool}
          title={t('features.toolkits.toolBase.toolActionsItems.unavailable', 'Tool is not available')}
          placement="top"
        >
          <Box component="span">
            <ChipWithCheckIcon
              clickable={!disabled}
              isSelected
              label={tool}
              onClick={onSelectTool(tool)}
              warning
              icon={
                <ErrorOutlineIcon
                  fontSize="small"
                  color="warning"
                />
              }
              sx={sx?.chip}
            />
          </Box>
        </Tooltip>
      ))}
      {toolsOptions.map((option) => (
        <ChipWithCheckIcon
          clickable={!disabled}
          key={option.value}
          isSelected={selectedTools.includes(option.value)}
          label={option.label}
          onClick={onSelectTool(option.value)}
          warning={false}
          sx={sx?.chip}
        />
      ))}
    </Stack>
  );
}

const stackSx: SxProps<Theme> = { marginTop: '0.5rem', gap: '1rem', flexWrap: 'wrap' };
