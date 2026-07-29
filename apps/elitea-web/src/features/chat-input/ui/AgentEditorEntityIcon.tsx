import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { ApplicationsIcon } from '@/shared/ui/icons/applications-icon';
import { FlowIcon } from '@/shared/ui/icons/flow-icon';

/**
 * Small local read-only entity-icon renderer scoped to `AgentEditorPanel
 * .tsx`'s one call site (`icon`/`entityType`/`editable={false}`/
 * `showBackgroundColor={false}` in the baseline). `features/agents/ui/
 * EntityIcon.tsx` exists but is scoped/unexported for a different single
 * call site (`ToolCard.jsx`'s port) — illegal to reach anyway (`no-
 * sideways-features`) — so this is its own small local version, per this
 * unit's own task brief, not the shared `GradientIconWrapper`-framed
 * version (the baseline call site here passes `showBackgroundColor=
 * {false}`, so there is no frame to reproduce).
 *
 * `useParticipantEntityIcon` (this unit's own simplified local port —
 * see that hook's own doc comment) never returns a `.component` field
 * (only the toolkit branch produced one, and that branch is unreachable
 * here), so this only ever needs the `icon.url` vs. fallback-glyph split.
 */
export function AgentEditorEntityIcon({
  iconUrl,
  isPipeline,
}: {
  readonly iconUrl: string | undefined;
  readonly isPipeline: boolean;
}): ReactNode {
  if (iconUrl) {
    return (
      <Box
        component="img"
        src={iconUrl}
        alt={t('chatInput.agentEditorPanel.entityIconAlt', 'Preview')}
        sx={imgSx}
      />
    );
  }
  return (
    <Box
      component={isPipeline ? FlowIcon : ApplicationsIcon}
      sx={glyphSx}
    />
  );
}

const imgSx: SxProps<Theme> = (theme: Theme) => ({ width: '1rem', height: '1rem', borderRadius: theme.vars.shape.radiusPill });
const glyphSx: SxProps<Theme> = { width: '1rem', height: '1rem' };
