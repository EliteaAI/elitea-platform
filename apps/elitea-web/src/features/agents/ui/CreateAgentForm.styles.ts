import type { SxProps, Theme } from '@mui/material/styles';

/**
 * `CreateAgentForm.tsx`'s style constants, split into their own file purely
 * to keep that file under the §3.5 400-line budget — it was at exactly
 * 400/400 with no headroom, and the budget is enforced twice
 * (`scripts/lib/budgets-core.mjs` and `.oxlintrc.json`'s `max-lines`, both
 * counting comments). Same move, same reason as `ToolCard.styles.ts`.
 * Moved verbatim: every declaration below is unchanged.
 */
export const rootContainerSx: SxProps<Theme> = {
  margin: '0.75rem auto 0',
  maxWidth: '40.1875rem',
};

export const accordionSx: SxProps<Theme> = (theme: Theme) => ({
  background: theme.vars.palette.background.tabPanel,
});

export const accordionContentSx: SxProps<Theme> = {
  paddingBottom: '1.5rem',
};

export const nameContainerSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  height: '4.25rem',
  width: '100%',
  gap: '1rem',
};

export const nameWrapperInputSx: SxProps<Theme> = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
};

export const nameCharactersLabelSx: SxProps<Theme> = {
  textAlign: 'right',
  width: '100%',
  position: 'absolute',
  bottom: '3.5rem',
};

export const descriptionWrapperSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
};

export const descriptionCharactersLabelSx: SxProps<Theme> = {
  textAlign: 'right',
  width: '100%',
  position: 'relative',
  top: '0.5rem',
};

export const instructionsContainerSx: SxProps<Theme> = {
  paddingBottom: '1rem',
  marginTop: '1rem',
};

/** The Instructions block's own action row — holds the "Edit with AI" trigger above the editor. */
export const instructionsAiEditSlotSx: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: '0.5rem',
};

export const welcomeMessageInputSx: SxProps<Theme> = {
  marginTop: '1rem',
};

export const conversationStartersSx: SxProps<Theme> = {
  marginTop: '1rem',
};

export const advanceSettingsSx: SxProps<Theme> = {
  marginTop: '1rem',
};
