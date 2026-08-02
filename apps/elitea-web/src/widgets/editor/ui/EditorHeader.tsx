import { Box, Typography, useTheme } from '@mui/material';

/**
 * Phase-3 Editor header: EditorHeader
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
export type EditorHeaderProps = {
  title: string;
  subtitle?: string;
  onCancel: () => void;
  onDiscard: () => void;
  saveButton?: React.ReactNode;
  isPublic?: boolean;
};

const EditorHeader = ({ title, subtitle, onCancel }: EditorHeaderProps) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.5rem 1rem',
        borderBottom: '1px solid',
        borderColor: 'border.lines',
        minHeight: '2.625rem',
        background: 'background.userInputBackground',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.4 }}>
        <Box
          component="span"
          sx={{
            cursor: 'pointer',
            fontSize: '1.125rem',
            color: theme.palette.icon.fill.default,
          }}
          onClick={onCancel}
        >
          ✕
        </Box>
        <Box>
          <Typography variant="subtitle1" color="text.secondary" noWrap sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.primary" noWrap sx={{ fontSize: '0.75rem' }}>
              {subtitle}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
};

EditorHeader.displayName = 'EditorHeader';

export default EditorHeader;
