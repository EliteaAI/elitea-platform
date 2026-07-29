import type { Theme } from '@mui/material/styles';

/** Style factory for `AgentEditorPanel.tsx`, split out to keep that file under the §3.5 budgets. */
export function agentEditorPanelStyles(isSmallView: boolean) {
  return {
    outerContainer: (theme: Theme) => ({
      display: 'flex',
      alignItems: 'center',
      gap: '0.25rem',
      padding: '0.25rem',
      borderRadius: theme.vars.shape.radiusPill,
      border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
      minWidth: 0,
      maxWidth: '100%',
    }),
    buttonRow: {
      display: 'flex',
      alignItems: 'center',
      minWidth: 0,
      maxWidth: '100%',
    },
    entityIconWrapper: {
      marginRight: isSmallView ? 0 : '.5rem',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    editingText: { fontWeight: 400 },
    settingIcon: { width: '1rem', height: '1rem' },
    closeButton: { padding: '0.375rem', flexShrink: 0 },
    participantName: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '100%',
    },
  };
}

export type AgentEditorPanelStyles = ReturnType<typeof agentEditorPanelStyles>;
