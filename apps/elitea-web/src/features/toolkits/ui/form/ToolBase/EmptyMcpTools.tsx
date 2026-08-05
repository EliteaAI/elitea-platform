import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { InfoIcon } from '@/shared/ui/icons/info-icon';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/
 * ToolBase/EmptyMcpTools.jsx` (52 lines) — the "no tools yet, press Load
 * Tools" hint shown by `ToolActionsSelector.tsx` for an MCP toolkit with no
 * fetched tools.
 *
 * DISCLOSED DEVIATION: the baseline rendered this hint's icon via
 * `<InfoTooltip infoTooltip={{icon: styles.info}} disableTooltip />` — a
 * purely decorative, `aria-hidden`, non-interactive glyph tinted the
 * "tips" palette colour, with `disableTooltip` meaning no tooltip content
 * ever showed. This app's ported `InfoTooltip` (`shared/ui/InfoTooltip`)
 * intentionally dropped that config-object shape (its own doc comment:
 * "flattens... to the ordinary shared/ui shape") and, more importantly,
 * ALWAYS renders a real, focusable `<button>`/`<a>` with an `aria-label` —
 * exactly the a11y fix that component's doc comment describes, but wrong
 * for a purely decorative icon with no click/tooltip behaviour at all
 * (it would add a focusable, actionable-looking control that does
 * nothing). Rendering `InfoIcon` directly, `aria-hidden`, matches the
 * baseline's actual accessibility semantics for this specific icon-only
 * use, rather than misusing a component built for a different contract.
 */
export function EmptyMcpTools(): ReactNode {
  return (
    <Box sx={containerSx}>
      <InfoIcon
        aria-hidden="true"
        width={14}
        height={14}
        style={{ flexShrink: 0 }}
      />
      <Typography
        variant="bodySmall"
        sx={textSx}
      >
        {t(
          'features.toolkits.toolBase.emptyMcpTools.message',
          'No tools to display for now. To get tools from MCP press button "Load Tools"',
        )}
      </Typography>
    </Box>
  );
}

function containerSx(theme: Theme) {
  return {
    marginTop: theme.spacing(1.5),
    display: 'flex',
    boxSizing: 'border-box' as const,
    alignItems: 'center',
    minHeight: '2.5rem',
    width: '100%',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5, 2),
    border: `0.0625rem solid ${theme.vars.palette.border.tips}`,
    borderRadius: theme.vars.shape.radiusMd ?? '0.5rem',
    background: theme.vars.palette.background.tips,
    color: theme.vars.palette.icon.fill.tips,
  };
}

function textSx(theme: Theme) {
  return { color: theme.vars.palette.text.tips };
}
