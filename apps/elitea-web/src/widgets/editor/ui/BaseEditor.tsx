import { useCallback, useState } from 'react';

import { Box } from '@mui/material';

/**
 * Phase-3 Editor shell: BaseEditor
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
export type BaseEditorProps = {
  isVisible: boolean;
  isDirty: boolean;
  setIsDirty?: (dirty: boolean) => void;
  onClose: () => void;
  title: string;
  subtitle?: string;
  onDiscard?: () => void;
  saveButton?: React.ReactNode;
  children: React.ReactNode;
};

const BaseEditor = ({
  isVisible,
  title,
  subtitle,
  onClose,
  saveButton,
  children,
}: BaseEditorProps) => {
  const [showWarning, setShowWarning] = useState(false);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleDiscard = useCallback(() => {
    setShowWarning(true);
  }, []);

  void showWarning;
  void handleDiscard;
  void saveButton;

  return (
    <Box
      sx={{
        display: isVisible ? 'flex' : 'none',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        border: '1px solid',
        borderColor: 'border.lines',
        borderRadius: '16px',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.5rem 1rem',
          borderBottom: '1px solid',
          borderColor: 'border.lines',
          minHeight: '2.625rem',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.4 }}>
          <Box
            component="span"
            sx={{ fontSize: '1rem', cursor: 'pointer' }}
            onClick={handleCancel}
          >
            ✕
          </Box>
          <Box>
            <Box sx={{ fontWeight: 600, fontSize: '0.875rem', lineHeight: '1.5rem' }}>
              {title}
            </Box>
            {subtitle && (
              <Box sx={{ fontSize: '0.75rem', lineHeight: '1rem' }}>{subtitle}</Box>
            )}
          </Box>
        </Box>
      </Box>
      <Box sx={{ flexGrow: 1, overflow: 'auto', padding: '16px' }}>
        {children}
      </Box>
    </Box>
  );
};

BaseEditor.displayName = 'BaseEditor';

export default BaseEditor;
